import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HOME_FOR_ROLE } from "../lib/constants";
import { Spinner } from "./ui";

/**
 * Gates a route behind login and, optionally, a set of roles.
 * A logged-in user hitting a page for another role is sent to their own home
 * rather than to the login screen.
 */
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner label="Restoring your session…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={HOME_FOR_ROLE[user.role] || "/login"} replace />;
  }

  return children;
}
