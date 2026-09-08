import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HOME_FOR_ROLE } from "../lib/constants";
import { Spinner } from "./ui";

/**
 * "/" resolves to the right landing page: the login screen when signed out,
 * otherwise the dashboard belonging to this user's role.
 */
export default function RoleHome() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner label="Loading FarmLink…" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <Navigate to={HOME_FOR_ROLE[user.role] || "/login"} replace />;
}
