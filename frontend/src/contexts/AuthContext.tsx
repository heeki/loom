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
  [key: string]: unknown;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: CognitoUser | null;
  accessToken: string | null;
  login: (username: string, password: string) => Promise<CognitoAuthResult>;
  completeNewPassword: (
    session: string,
    username: string,
    newPassword: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  accessToken: null,
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
        if (!cfg.user_pool_id || !cfg.user_client_id) {
          setIsLoading(false);
        }
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  // Mark loading done once config is loaded (if pool is configured, user must log in)
  useEffect(() => {
    if (config && config.user_pool_id && config.user_client_id) {
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
              config.user_client_id,
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
          setUser({
            sub: claims.sub as string,
            email: claims.email as string | undefined,
            username:
              (claims["cognito:username"] as string) || (claims.sub as string),
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
        config.user_client_id,
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
        config.user_client_id,
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
    config?.user_pool_id && config?.user_client_id,
  );

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: isConfigured ? tokens !== null : true,
        isLoading,
        user,
        accessToken: tokens?.accessToken ?? null,
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
