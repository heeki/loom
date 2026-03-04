"""
CloudWatch Logs wrapper for retrieving and parsing AgentCore Runtime logs.

This module provides functions to interact with AWS CloudWatch Logs API
for retrieving log events related to AgentCore Runtime invocations and
parsing agent start times from log messages.
"""

import json
import time
from datetime import datetime
from typing import Any


def list_log_streams(log_group: str, region: str) -> list[dict[str, Any]]:
    """
    List all log streams in a CloudWatch log group, filtered and ordered by last event time.

    Args:
        log_group: CloudWatch log group name (e.g., '/aws/bedrock-agentcore/runtimes/...')
        region: AWS region name

    Returns:
        List of log stream dictionaries with 'name' and 'last_event_time' keys,
        excluding validation streams, ordered by most recent first
    """
    import boto3

    client = boto3.client('logs', region_name=region)

    try:
        response = client.describe_log_streams(
            logGroupName=log_group,
            orderBy='LastEventTime',
            descending=True
        )
        streams = response.get('logStreams', [])
    except Exception:
        # Fallback: try without ordering if that fails
        try:
            response = client.describe_log_streams(logGroupName=log_group)
            streams = response.get('logStreams', [])
        except Exception:
            return []

    # Filter out AWS validation streams and return normalized results
    result = []
    for stream in streams:
        stream_name = stream['logStreamName']
        if 'log_stream_created_by_aws_to_validate_log_delivery_subscriptions' not in stream_name:
            result.append({
                'name': stream_name,
                'last_event_time': stream.get('lastEventTimestamp', 0)
            })

    return result


def get_stream_log_events(
    log_group: str,
    stream_name: str,
    region: str,
    start_time_ms: int | None = None,
    end_time_ms: int | None = None,
    limit: int = 100
) -> list[dict[str, Any]]:
    """
    Retrieve log events from a single CloudWatch log stream.

    Unlike get_log_events(), this does not retry or filter by session ID.
    It queries a single stream directly, suitable for general log browsing.

    Args:
        log_group: CloudWatch log group name
        stream_name: Name of the specific log stream to query
        region: AWS region name
        start_time_ms: Optional start time filter (milliseconds since epoch)
        end_time_ms: Optional end time filter (milliseconds since epoch)
        limit: Maximum number of events to return

    Returns:
        List of log event dictionaries with 'timestamp' and 'message' keys
    """
    import boto3

    client = boto3.client('logs', region_name=region)

    params: dict[str, Any] = {
        'logGroupName': log_group,
        'logStreamNames': [stream_name],
        'limit': limit
    }

    if start_time_ms is not None:
        params['startTime'] = start_time_ms
    if end_time_ms is not None:
        params['endTime'] = end_time_ms

    response = client.filter_log_events(**params)
    return response.get('events', [])


def get_log_events(
    log_group: str,
    session_id: str,
    region: str,
    start_time_ms: int | None = None,
    limit: int = 100,
    max_retries: int = 12,
    retry_interval: float = 5.0
) -> list[dict[str, Any]]:
    """
    Retrieve CloudWatch log events matching a session ID, with retry logic.

    Polls CloudWatch for up to `max_retries` attempts, waiting `retry_interval` seconds
    between attempts. This handles log ingestion delays.

    Args:
        log_group: CloudWatch log group name
        session_id: Session ID to filter logs by
        region: AWS region name
        start_time_ms: Optional start time in milliseconds since epoch (filter events after this time)
        limit: Maximum number of events to return (not strictly enforced due to pagination)
        max_retries: Maximum number of polling attempts
        retry_interval: Seconds to wait between retry attempts

    Returns:
        List of log event dictionaries with keys:
        - 'timestamp': milliseconds since epoch
        - 'message': log message string
    """
    import boto3

    client = boto3.client('logs', region_name=region)

    # Get available log streams
    streams = list_log_streams(log_group, region)
    stream_names = [s['name'] for s in streams]

    if not stream_names:
        # Fallback to default stream name if none found
        stream_names = ['BedrockAgentCoreRuntime_ApplicationLogs']

    all_events = []
    retry_count = 0

    while retry_count < max_retries:
        if retry_count > 0:
            time.sleep(retry_interval)

        # Try to retrieve log events from each stream
        for stream_name in stream_names:
            try:
                # Build filter_log_events parameters
                params: dict[str, Any] = {
                    'logGroupName': log_group,
                    'logStreamNames': [stream_name],
                    'limit': limit
                }

                if start_time_ms is not None:
                    params['startTime'] = start_time_ms

                response = client.filter_log_events(**params)
                events = response.get('events', [])
                all_events.extend(events)

            except Exception:
                # If specific stream fails, try without specifying stream names
                try:
                    params = {
                        'logGroupName': log_group,
                        'limit': limit
                    }
                    if start_time_ms is not None:
                        params['startTime'] = start_time_ms

                    response = client.filter_log_events(**params)
                    events = response.get('events', [])
                    all_events.extend(events)
                except Exception:
                    pass  # Continue to next stream or retry

        # Filter events by session ID
        matching_events = _filter_events_by_session_id(all_events, session_id)

        if matching_events:
            return matching_events

        retry_count += 1
        all_events = []  # Clear for next retry

    return []


def _filter_events_by_session_id(events: list[dict[str, Any]], session_id: str) -> list[dict[str, Any]]:
    """
    Filter log events to only those containing the specified session ID.

    Checks both raw message content and parsed JSON messages for session ID matches.

    Args:
        events: List of CloudWatch log event dictionaries
        session_id: Session ID to match

    Returns:
        List of matching log events
    """
    matching = []

    for event in events:
        message = event.get('message', '')

        # Direct string match
        if session_id in message:
            matching.append(event)
            continue

        # Try parsing as JSON and checking sessionId field
        if message.startswith('{'):
            try:
                log_data = json.loads(message)
                if session_id in log_data.get('sessionId', ''):
                    matching.append(event)
                    continue
                # Also check inner message field
                if session_id in log_data.get('message', ''):
                    matching.append(event)
            except json.JSONDecodeError:
                pass

    return matching


def parse_agent_start_time(log_events: list[dict[str, Any]]) -> float | None:
    """
    Parse the agent start time from log events.

    First searches for the "Agent invoked - Start time:" pattern. If not found,
    falls back to the earliest CloudWatch event timestamp as an approximation of
    when the agent started processing.

    Log message format examples:
        - "Agent invoked - Start time: 2026-02-11T19:44:38.558763, Request ID: ..."
        - {"message": "Agent invoked - Start time: ...", "sessionId": "..."}

    Args:
        log_events: List of CloudWatch log event dictionaries

    Returns:
        Unix timestamp (seconds since epoch) of agent start time, or None if not found
    """
    import logging
    logger = logging.getLogger(__name__)

    for event in log_events:
        message = event.get('message', '')

        # Parse JSON-wrapped messages
        if message.startswith('{'):
            try:
                log_data = json.loads(message)
                inner_message = log_data.get('message', '')
            except json.JSONDecodeError:
                inner_message = message
        else:
            inner_message = message

        # Look for "Agent invoked" pattern
        if 'Agent invoked' not in inner_message:
            continue

        # Extract timestamp after "Start time:"
        if 'Start time:' not in inner_message:
            continue

        try:
            # Extract the timestamp portion
            start_time_str = inner_message.split('Start time:')[1].strip()

            # Handle different formats: "2026-02-11T19:44:38.558763, Request ID: ..."
            if ',' in start_time_str:
                start_time_str = start_time_str.split(',')[0].strip()

            # Normalize timezone format for parsing
            if '.' in start_time_str and '+' not in start_time_str and 'Z' not in start_time_str:
                # Add UTC timezone if missing
                start_time_str += '+00:00'
            elif start_time_str.endswith('Z'):
                # Replace Z with +00:00
                start_time_str = start_time_str[:-1] + '+00:00'

            # Parse ISO format timestamp
            start_time_dt = datetime.fromisoformat(start_time_str)
            return start_time_dt.timestamp()

        except (ValueError, IndexError):
            continue

    # Fallback: use the earliest CloudWatch event timestamp.
    # This approximates when the agent started processing, since
    # not all agents emit the "Agent invoked - Start time:" log pattern.
    earliest_ts = None
    for event in log_events:
        ts = event.get('timestamp')
        if ts is not None:
            # CloudWatch timestamps are in milliseconds
            ts_seconds = ts / 1000.0
            if earliest_ts is None or ts_seconds < earliest_ts:
                earliest_ts = ts_seconds

    if earliest_ts is not None:
        logger.info("Used earliest CloudWatch event timestamp as agent_start_time fallback: %.3f", earliest_ts)

    return earliest_ts
