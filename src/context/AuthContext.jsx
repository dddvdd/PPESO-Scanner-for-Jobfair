import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSupabase } from "../lib/supabaseClient.js";
import { myRole, staffAccountStatus } from "../lib/api.js";

const AuthContext = createContext(null);

/**
 * Authentication state and application role are separate concepts.
 *
 * - session/user come from supabase.auth
 * - role comes exclusively from the my_role() RPC ("admin" | "staff" | null)
 *
 * session.user.role is the JWT role and is "authenticated" for every signed-in
 * user regardless of standing — it must never be consulted for authorization.
 * Role resolution fails closed: any failure leaves role null.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [role, setRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [municipality, setMunicipality] = useState(null);
  const roleRequestIdRef = useRef(0);
  const userIdRef = useRef(null);

  const refreshRole = useCallback(async () => {
    const requestId = ++roleRequestIdRef.current;
    setRoleLoading(true);
    try {
      const [result, account] = await Promise.all([myRole(), staffAccountStatus()]);
      if (requestId !== roleRequestIdRef.current) return;
      setRole(result.ok ? (result.data ?? null) : null);
      // Missing account state fails closed, including on page refresh.
      setMustChangePassword(!account.ok || account.data?.must_change_password !== false);
      setMunicipality(account.ok ? account.data?.municipality ?? null : null);
    } finally {
      if (requestId === roleRequestIdRef.current) setRoleLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    let disposed = false;

    const ingest = (nextSession) => {
      if (disposed) return;
      setSession(nextSession);
      const nextUserId = nextSession?.user?.id ?? null;

      if (nextUserId !== userIdRef.current) {
        const signedOut = nextUserId === null;
        userIdRef.current = nextUserId;

        if (signedOut) {
          roleRequestIdRef.current += 1;
          setRole(null);
          setMustChangePassword(true);
          setMunicipality(null);
          setRoleLoading(false);
        } else {
          setRole(null);
          setMustChangePassword(true);
          setMunicipality(null);
          refreshRole();
        }
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      ingest(data.session ?? null);
      if (!disposed) setInitializing(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        ingest(nextSession);
      }
    );

    return () => {
      disposed = true;
      subscription.subscription.unsubscribe();
    };
  }, [refreshRole]);

  const signOut = useCallback(() => getSupabase().auth.signOut(), []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      role,
      roleLoading,
      mustChangePassword,
      municipality,
      isAdmin: role === "admin",
      isStaff: role === "staff" || role === "admin",
      refreshRole,
      signOut,
    }),
    [session, initializing, role, roleLoading, mustChangePassword, municipality, refreshRole, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
