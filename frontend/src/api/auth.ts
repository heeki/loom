import { apiFetch } from "./client";

export interface AuthConfig {
  user_pool_id: string;
  user_client_id: string;
  region: string;
}

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

export interface CognitoAuthResult {
  ChallengeName?: string;
  Session?: string;
  AuthenticationResult?: {
    IdToken: string;
    AccessToken: string;
    RefreshToken: string;
    ExpiresIn: number;
    TokenType: string;
  };
}

export function fetchAuthConfig(): Promise<AuthConfig> {
  return apiFetch<AuthConfig>("/api/auth/config");
}

export async function initiateAuth(
  username: string,
  password: string,
  clientId: string,
  region: string,
): Promise<CognitoAuthResult> {
  const response = await fetch(
    `https://cognito-idp.${region}.amazonaws.com/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
        },
      }),
    },
  );

  if (!response.ok) {
    const error = (await response.json()) as {
      message?: string;
      __type?: string;
    };
    throw new Error(
      error.message || `Authentication failed: ${response.status}`,
    );
  }

  return response.json() as Promise<CognitoAuthResult>;
}

export async function respondToNewPasswordChallenge(
  session: string,
  username: string,
  newPassword: string,
  clientId: string,
  region: string,
): Promise<CognitoAuthResult> {
  const response = await fetch(
    `https://cognito-idp.${region}.amazonaws.com/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target":
          "AWSCognitoIdentityProviderService.RespondToAuthChallenge",
      },
      body: JSON.stringify({
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        ClientId: clientId,
        Session: session,
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
      }),
    },
  );

  if (!response.ok) {
    const error = (await response.json()) as {
      message?: string;
      __type?: string;
    };
    throw new Error(
      error.message || `Password change failed: ${response.status}`,
    );
  }

  return response.json() as Promise<CognitoAuthResult>;
}

export async function refreshTokens(
  refreshToken: string,
  clientId: string,
  region: string,
): Promise<CognitoAuthResult> {
  const response = await fetch(
    `https://cognito-idp.${region}.amazonaws.com/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      }),
    },
  );

  if (!response.ok) {
    const error = (await response.json()) as {
      message?: string;
      __type?: string;
    };
    throw new Error(
      error.message || `Token refresh failed: ${response.status}`,
    );
  }

  return response.json() as Promise<CognitoAuthResult>;
}
