import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HOME_FOR_ROLE } from "../lib/constants";
import Landing from "../pages/Landing";
import BrandMark from "./BrandMark";

/**
 * "/" resolves by who is asking: the marketing landing page for a visitor,
 * the dashboard belonging to their role for anyone signed in.
 */
export default function RoleHome() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="fl-soil flex min-h-screen flex-col items-center justify-center gap-5">
        <BrandMark size={52} animated />
        <p className="text-sm text-white/50">Loading FarmLink…</p>
      </div>
    );
  }

  if (!user) return <Landing />;

  return <Navigate to={HOME_FOR_ROLE[user.role] || "/login"} replace />;
}
