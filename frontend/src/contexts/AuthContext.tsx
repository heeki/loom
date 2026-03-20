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
import { setAuthToken, setOnUnauthorized } from "@/api/client";
import { recordLogin } from "@/api/audit";

interface CognitoUser {
  sub: string;
  email?: string;
  username?: string;
  groups?: string[];
  [key: string]: unknown;
}

export type Scope =
  | "catalog:read" | "catalog:write"
  | "agent:read" | "agent:write"
  | "memory:read" | "memory:write"
  | "security:read" | "security:write"
  | "settings:read" | "settings:write"
  | "tagging:read" | "tagging:write"
  | "costs:read" | "costs:write"
  | "mcp:read" | "mcp:write"
  | "a2a:read" | "a2a:write"
  | "invoke";

const GROUP_SCOPES: Record<string, Scope[]> = {
  // Type groups (for UI routing - don't grant scopes directly)
  "t-admin": [],
  "t-user": [],

  // Admin groups (t-admin users - single group only)
  "g-admins-super": [
    "catalog:read", "catalog:write", "agent:read", "agent:write",
    "memory:read", "memory:write", "security:read", "security:write",
    "settings:read", "settings:write", "tagging:read", "tagging:write",
    "costs:read", "costs:write",
    "mcp:read", "mcp:write", "a2a:read", "a2a:write", "invoke",
  ],
  "g-admins-demo": [
    "catalog:read", "agent:read", "agent:write", "memory:read", "memory:write",
    "security:read", "settings:read", "tagging:read", "costs:read", "costs:write",
    "mcp:read", "a2a:read", "invoke",
  ],
  "g-admins-security": [
    "security:read", "security:write", "settings:read", "tagging:read", "tagging:write",
  ],
  "g-admins-memory": [
    "memory:read", "memory:write", "settings:read", "tagging:read", "tagging:write",
  ],
  "g-admins-mcp": [
    "mcp:read", "mcp:write", "settings:read", "tagging:read", "tagging:write",
  ],
  "g-admins-a2a": [
    "a2a:read", "a2a:write", "settings:read", "tagging:read", "tagging:write",
  ],

  // User groups (t-user users - can have multiple)
  "g-users-demo": ["catalog:read", "agent:read", "memory:read", "costs:read", "costs:write", "invoke"],
  "g-users-test": ["catalog:read", "agent:read", "memory:read", "costs:read", "costs:write", "invoke"],
  "g-users-strategics": ["catalog:read", "agent:read", "memory:read", "costs:read", "costs:write", "invoke"],
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
  browserSessionId: string | null;
}

const ALL_SCOPES = new Set<Scope>([
  "catalog:read", "catalog:write", "agent:read", "agent:write",
  "memory:read", "memory:write", "security:read", "security:write",
  "settings:read", "settings:write", "tagging:read", "tagging:write",
  "costs:read", "costs:write",
  "mcp:read", "mcp:write", "a2a:read", "a2a:write", "invoke",
]);
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
  browserSessionId: null,
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
  const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokensRef = useRef<AuthTokens | null>(null);
  tokensRef.current = tokens;
  const configRef = useRef<AuthConfig | null>(null);
  configRef.current = config;

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

  // Register 401 interceptor: refresh the token and return the new access token
  useEffect(() => {
    setOnUnauthorized(async () => {
      const currentTokens = tokensRef.current;
      const currentConfig = configRef.current;
      if (!currentTokens?.refreshToken || !currentConfig) return null;
      try {
        const result = await refreshTokens(
          currentTokens.refreshToken,
          import.meta.env.VITE_COGNITO_USER_CLIENT_ID,
          currentConfig.region,
        );
        if (result.AuthenticationResult) {
          const newTokens: AuthTokens = {
            idToken: result.AuthenticationResult.IdToken,
            accessToken: result.AuthenticationResult.AccessToken,
            refreshToken: currentTokens.refreshToken,
          };
          setTokens(newTokens);
          setAuthToken(newTokens.accessToken);
          scheduleRefresh(newTokens.accessToken, newTokens.refreshToken);
          return newTokens.accessToken;
        }
      } catch {
        setTokens(null);
        setUser(null);
        setAuthToken(null);
      }
      return null;
    });
    return () => setOnUnauthorized(null);
  }, [scheduleRefresh]);

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

        // Generate browser session ID and record login
        const sessionId = crypto.randomUUID();
        setBrowserSessionId(sessionId);
        try {
          const claims = decodeJwtPayload(newTokens.idToken);
          const username = (claims["cognito:username"] as string) || (claims.sub as string);
          recordLogin(username, sessionId).catch(() => {});
        } catch {
          // ignore
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
    setBrowserSessionId(null);
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
        browserSessionId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
