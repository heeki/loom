import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  fetchAuthConfig,
  initiateAuth,
  respondToNewPasswordChallenge,
  refreshTokens,
  type AuthConfig,
  type AuthTokens,
  type CognitoAuthResult,
} from "@/api/auth";
import { setAuthToken } from "@/api/client";

interface CognitoUser {
  sub: string;
  email?: string;
  username?: string;
  groups?: string[];
  [key: string]: unknown;
}

export type Scope = "agent:read" | "agent:write" | "security:read" | "security:write" | "data:read" | "data:write";

const GROUP_SCOPES: Record<string, Scope[]> = {
  admins: ["agent:read", "agent:write", "security:read", "security:write", "data:read", "data:write"],
  "security-admins": ["security:read", "security:write"],
  "data-stewards": ["data:read", "data:write"],
  builders: ["agent:read", "agent:write"],
  operators: ["agent:read", "security:read", "data:read"],
};

function deriveScopes(groups: string[]): Set<Scope> {
  const scopes = new Set<Scope>();
  for (const group of groups) {
    const groupScopes = GROUP_SCOPES[group];
    if (groupScopes) {
      for (const scope of groupScopes) {
        scopes.add(scope);
      }
    }
  }
  return scopes;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: CognitoUser | null;
  accessToken: string | null;
  scopes: Set<Scope>;
  hasScope: (scope: Scope) => boolean;
  login: (username: string, password: string) => Promise<CognitoAuthResult>;
  completeNewPassword: (
    session: string,
    username: string,
    newPassword: string,
  ) => Promise<void>;
  logout: () => void;
}

const ALL_SCOPES = new Set<Scope>(["agent:read", "agent:write", "security:read", "security:write", "data:read", "data:write"]);
const EMPTY_SCOPES = new Set<Scope>();

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  accessToken: null,
  scopes: EMPTY_SCOPES,
  hasScope: () => false,
  login: async () => ({}),
  completeNewPassword: async () => {},
  logout: () => {},
});

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const payload = parts[1]!;
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decoded) as Record<string, unknown>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<CognitoUser | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch auth config on mount
  useEffect(() => {
    fetchAuthConfig()
      .then((cfg) => {
        setConfig(cfg);
        // If no pool configured, skip auth
        if (!cfg.user_pool_id || !import.meta.env.VITE_COGNITO_USER_CLIENT_ID) {
          setIsLoading(false);
        }
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  // Mark loading done once config is loaded (if pool is configured, user must log in)
  useEffect(() => {
    if (config && config.user_pool_id && import.meta.env.VITE_COGNITO_USER_CLIENT_ID) {
      setIsLoading(false);
    }
  }, [config]);

  const scheduleRefresh = useCallback(
    (accessToken: string, refreshToken: string) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      try {
        const claims = decodeJwtPayload(accessToken);
        const exp = claims.exp as number;
        // Refresh 60 seconds before expiry
        const refreshIn = Math.max((exp - Date.now() / 1000 - 60) * 1000, 0);

        refreshTimerRef.current = setTimeout(async () => {
          if (!config) return;
          try {
            const result = await refreshTokens(
              refreshToken,
              import.meta.env.VITE_COGNITO_USER_CLIENT_ID,
              config.region,
            );
            if (result.AuthenticationResult) {
              const newTokens: AuthTokens = {
                idToken: result.AuthenticationResult.IdToken,
                accessToken: result.AuthenticationResult.AccessToken,
                // Refresh token is not returned on refresh; keep existing
                refreshToken: refreshToken,
              };
              setTokens(newTokens);
              setAuthToken(newTokens.accessToken);
              scheduleRefresh(newTokens.accessToken, newTokens.refreshToken);
            }
          } catch {
            // Refresh failed - user must re-login
            setTokens(null);
            setUser(null);
            setAuthToken(null);
          }
        }, refreshIn);
      } catch {
        // Cannot decode token
      }
    },
    [config],
  );

  const processAuthResult = useCallback(
    (result: CognitoAuthResult) => {
      if (result.AuthenticationResult) {
        const newTokens: AuthTokens = {
          idToken: result.AuthenticationResult.IdToken,
          accessToken: result.AuthenticationResult.AccessToken,
          refreshToken: result.AuthenticationResult.RefreshToken,
        };
        setTokens(newTokens);
        setAuthToken(newTokens.accessToken);

        // Decode id token for user info
        try {
          const claims = decodeJwtPayload(newTokens.idToken);
          const groups = (claims["cognito:groups"] as string[] | undefined) ?? [];
          setUser({
            sub: claims.sub as string,
            email: claims.email as string | undefined,
            username:
              (claims["cognito:username"] as string) || (claims.sub as string),
            groups,
          });
        } catch {
          // Fallback user
          setUser({ sub: "unknown" });
        }

        scheduleRefresh(newTokens.accessToken, newTokens.refreshToken);
      }
    },
    [scheduleRefresh],
  );

  const login = useCallback(
    async (username: string, password: string): Promise<CognitoAuthResult> => {
      if (!config) throw new Error("Auth not configured");
      const result = await initiateAuth(
        username,
        password,
        import.meta.env.VITE_COGNITO_USER_CLIENT_ID,
        config.region,
      );
      processAuthResult(result);
      return result;
    },
    [config, processAuthResult],
  );

  const completeNewPassword = useCallback(
    async (session: string, username: string, newPassword: string) => {
      if (!config) throw new Error("Auth not configured");
      const result = await respondToNewPasswordChallenge(
        session,
        username,
        newPassword,
        import.meta.env.VITE_COGNITO_USER_CLIENT_ID,
        config.region,
      );
      processAuthResult(result);
    },
    [config, processAuthResult],
  );

  const logout = useCallback(() => {
    setTokens(null);
    setUser(null);
    setAuthToken(null);
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const isConfigured = Boolean(
    config?.user_pool_id && import.meta.env.VITE_COGNITO_USER_CLIENT_ID,
  );

  // When auth is not configured, grant all scopes
  const scopes = !isConfigured
    ? ALL_SCOPES
    : user?.groups
      ? deriveScopes(user.groups)
      : EMPTY_SCOPES;

  const hasScope = useCallback(
    (scope: Scope) => scopes.has(scope),
    [scopes],
  );

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: isConfigured ? tokens !== null : true,
        isLoading,
        user,
        accessToken: tokens?.accessToken ?? null,
        scopes,
        hasScope,
        login,
        completeNewPassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
