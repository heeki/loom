# Loom: A Simple Agent Platform Prototype

This project is a prototype for an agent platform that simplifies the process of building, testing, integrating, deploying, and operating agents. The platform provides a streamlined user experience with an opinionated backend architecture.

## Overview

The agent platform prototype leverages:
- **Amazon Bedrock AgentCore** for foundational agent capabilities
- **AWS Strands Agents** for advanced reasoning and planning

This combination provides a robust foundation for creating intelligent agents that can handle complex tasks while maintaining simplicity in development and operations.

## Features

- Simple agent creation workflow
- Integrated testing environment
- Seamless deployment processes
- Operational tooling for monitoring and maintenance
- Opinionated backend that reduces configuration complexity

## Project Structure

```
├── src/          # Source code for agents
├── iac/          # Infrastructure as Code
├── etc/          # Configuration files
└── tmp/          # Temporary files
```

## Getting Started

To begin working with this agent platform prototype:

1. Review the project structure in `src/`, `iac/`, and `etc/`
2. Check the configuration files in `etc/` for environment settings
3. Examine the infrastructure definitions in `iac/` for deployment requirements

## Architecture

The platform utilizes Amazon Bedrock's AgentCore as the foundation for agent capabilities, while incorporating AWS Strands Agents for enhanced reasoning and planning functionality. This architecture provides both the reliability of proven AWS services and the flexibility to build sophisticated agent behaviors.