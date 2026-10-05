import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { login } from "../lib/api";

const SESSION_KEY = "pos_session_remember";
const IS_VAULT_BANK_DASHBOARD = import.meta.env.VITE_APP_MODE === "vault-bank";

type LoginLocationState = { from?: { pathname?: string } };

export const LoginPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as LoginLocationState | null;
  const from = routeState?.from?.pathname || (IS_VAULT_BANK_DASHBOARD ? "/vault-bank" : "/");


  useEffect(() => {
    try {
      const remembered = localStorage.getItem(SESSION_KEY);
      if (remembered) {
        const data = JSON.parse(remembered);
        if (data?.username) setUsername(data.username);
        if (data?.remember) setRememberMe(true);
      }
    } catch {
      // Ignore unreadable remembered-session data and allow a fresh login.
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 800));

      const data = await login(username, password);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      if (rememberMe) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ username, remember: true, savedAt: Date.now() }));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }

      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes animationLeftRight {
          0%   { transform: translateX(0); }
          50%  { transform: translateX(1000px); }
          100% { transform: translateX(0); }
        }
        @keyframes animationRightLeft {
          0%   { transform: translateX(0); }
          50%  { transform: translateX(-1000px); }
          100% { transform: translateX(0); }
        }
        .anim-left-right {
          animation: animationLeftRight 2s ease-in-out infinite;
        }
        .anim-left-right-3s {
          animation: animationLeftRight 3s ease-in-out infinite;
        }
        .anim-left-right-4s {
          animation: animationLeftRight 4s ease-in-out infinite;
        }
        .anim-right-left {
          animation: animationRightLeft 2s ease-in-out infinite;
        }
        .anim-right-left-3s {
          animation: animationRightLeft 3s ease-in-out infinite;
        }
        .anim-right-left-4s {
          animation: animationRightLeft 4s ease-in-out infinite;
        }
        .login-field-input {
          font-size: 16px;
          padding: 8px 16px;
          width: 100%;
          min-height: 44px;
          border: none;
          border-radius: 4px;
          box-shadow: rgba(60, 66, 87, 0.16) 0 0 0 1px;
          outline: none;
          box-sizing: border-box;
          background: white;
          color: #1a1a2e;
        }
        .login-field-input:focus {
          box-shadow: rgba(84, 105, 212, 0.5) 0 0 0 2px;
        }
        .login-submit-btn {
          font-size: 16px;
          padding: 8px 16px;
          width: 100%;
          min-height: 44px;
          border: none;
          border-radius: 4px;
          background: rgb(84, 105, 212);
          color: white;
          font-weight: 600;
          cursor: pointer;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.2s;
        }
        .login-submit-btn:hover:not(:disabled) {
          background: rgb(67, 84, 170);
        }
        .login-submit-btn:disabled {
          opacity: 0.7;
          cursor: wait;
        }
        .login-checkbox {
          width: 14px;
          height: 14px;
          margin-right: 8px;
          cursor: pointer;
          accent-color: rgb(84, 105, 212);
        }
        .footer-link a {
          color: rgb(84, 105, 212);
          text-decoration: none;
        }
        .footer-link a:hover {
          text-decoration: underline;
        }
        .login-form-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #3c4257;
          margin-bottom: 6px;
        }
        .password-wrapper {
          position: relative;
        }
        .password-toggle-btn {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #6b7c93;
          padding: 2px;
          display: flex;
          align-items: center;
        }
        .password-toggle-btn:hover {
          color: #3c4257;
        }
      `}</style>

      {/* Root */}
      <div style={{
        background: "white",
        display: "flex",
        width: "100%",
        minHeight: "100vh",
        overflow: "hidden",
      }}>
        <div style={{
          minHeight: "100vh",
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
        }}>

          {/* Animated Background */}
          <div style={{
            minHeight: 692,
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 0,
            overflow: "hidden",
            background: "white",
            paddingTop: 64,
          }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "[start] 1fr [left-gutter] repeat(16, 86.6px) [left-gutter] 1fr [end]",
              gridTemplateRows: "[top] 1fr [top-gutter] repeat(8, 64px) [bottom-gutter] 1fr [bottom]",
              justifyContent: "center",
              margin: "0 -2%",
              transform: "rotate(-12deg) skew(-12deg)",
              height: "100%",
            }}>
              {/* Top gradient */}
              <div style={{ gridArea: "top / start / 8 / end", display: "flex" }}>
                <div style={{
                  backgroundImage: "linear-gradient(white 0%, rgb(247, 250, 252) 33%)",
                  flexGrow: 1,
                }} />
              </div>

              {/* Row 4, col 2-5 — light border box, left anim 3s */}
              <div style={{ gridArea: "4 / 2 / auto / 5", display: "flex" }}>
                <div className="anim-left-right-3s" style={{
                  flexGrow: 1,
                  boxShadow: "inset 0 0 0 2px #e3e8ee",
                }} />
              </div>

              {/* Row 6, start-2 — blue800 */}
              <div style={{ gridArea: "6 / start / auto / 2", display: "flex" }}>
                <div style={{ flexGrow: 1, background: "#212d63" }} />
              </div>

              {/* Row 7, start-4 — blue, left anim */}
              <div style={{ gridArea: "7 / start / auto / 4", display: "flex" }}>
                <div className="anim-left-right" style={{ flexGrow: 1, background: "#5469d4" }} />
              </div>

              {/* Row 8, 4-6 — gray100, left anim 3s */}
              <div style={{ gridArea: "8 / 4 / auto / 6", display: "flex" }}>
                <div className="anim-left-right-3s" style={{ flexGrow: 1, background: "#e3e8ee" }} />
              </div>

              {/* Row 2, 15-end — cyan200, right anim 4s */}
              <div style={{ gridArea: "2 / 15 / auto / end", display: "flex" }}>
                <div className="anim-right-left-4s" style={{ flexGrow: 1, background: "#7fd3ed" }} />
              </div>

              {/* Row 3, 14-end — blue, right anim */}
              <div style={{ gridArea: "3 / 14 / auto / end", display: "flex" }}>
                <div className="anim-right-left" style={{ flexGrow: 1, background: "#5469d4" }} />
              </div>

              {/* Row 4, 17-20 — gray100, right anim 4s */}
              <div style={{ gridArea: "4 / 17 / auto / 20", display: "flex" }}>
                <div className="anim-right-left-4s" style={{ flexGrow: 1, background: "#e3e8ee" }} />
              </div>

              {/* Row 5, 14-17 — light border, right anim 3s */}
              <div style={{ gridArea: "5 / 14 / auto / 17", display: "flex" }}>
                <div className="anim-right-left-3s" style={{
                  flexGrow: 1,
                  boxShadow: "inset 0 0 0 2px #e3e8ee",
                }} />
              </div>
            </div>
          </div>

          {/* Content above background */}
          <div style={{
            flexGrow: 1,
            zIndex: 9,
            display: "flex",
            flexDirection: "column",
            paddingTop: 24,
          }}>

            {/* Title */}
            <div style={{
              paddingTop: 48,
              paddingBottom: 24,
              display: "flex",
              justifyContent: "center",
            }}>
              <h1 style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "0.05em",
                color: "#1a1a2e",
                textAlign: "center",
              }}>
                VAULT BANK PAYMENT SOLUTION
              </h1>
            </div>

            {/* Form outer */}
            <div className="footer-link" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>

              {/* Form card */}
              <div style={{
                margin: "0 auto",
                width: "100%",
                maxWidth: 448,
                background: "white",
                borderRadius: 4,
                boxShadow: "rgba(60, 66, 87, 0.12) 0 7px 14px 0, rgba(0, 0, 0, 0.12) 0 3px 6px 0",
              }}>
                <div style={{ padding: "40px 48px" }}>
                  <span style={{
                    display: "block",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#3c4257",
                    marginBottom: 24,
                  }}>
                    Sign in to your account
                  </span>

                  {/* Error message */}
                  {error && (
                    <div style={{
                      marginBottom: 16,
                      padding: "10px 14px",
                      background: "#fff5f5",
                      border: "1px solid #ffd0d0",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#e53e3e" style={{ flexShrink: 0 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span style={{ fontSize: 14, color: "#c53030", fontWeight: 500 }}>{error}</span>
                    </div>
                  )}

                  <form onSubmit={handleSubmit}>

                    {/* Username field */}
                    <div style={{ marginBottom: 24 }}>
                      <label htmlFor="username" className="login-form-label">Username</label>
                      <input
                        id="username"
                        type="text"
                        autoComplete="username"
                        required
                        className="login-field-input"
                        placeholder="Enter username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>

                    {/* Password field */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <label htmlFor="password" className="login-form-label" style={{ margin: 0 }}>Password</label>
                        <a href="#" style={{ fontSize: 13, color: "rgb(84, 105, 212)", textDecoration: "none" }}>
                          Forgot your password?
                        </a>
                      </div>
                      <div className="password-wrapper">
                        <input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          required
                          className="login-field-input"
                          placeholder="Enter your password"
                          style={{ paddingRight: 40 }}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="password-toggle-btn"
                          onClick={() => setShowPassword(v => !v)}
                          tabIndex={-1}
                          title={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? (
                            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Stay signed in checkbox */}
                    <div style={{ marginBottom: 24, display: "flex", alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: 14, color: "#3c4257", cursor: "pointer", userSelect: "none" }}>
                        <input
                          id="remember-me"
                          type="checkbox"
                          className="login-checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                        />
                        Stay signed in for a week
                      </label>
                    </div>

                    {/* Submit button */}
                    <div style={{ marginBottom: 8 }}>
                      <button
                        type="submit"
                        disabled={loading}
                        className="login-submit-btn"
                      >
                        {loading ? (
                          <>
                            <svg className="animate-spin" style={{ width: 18, height: 18 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Signing in…
                          </>
                        ) : "Continue"}
                      </button>
                    </div>

                  </form>
                </div>
              </div>

              {/* Footer links */}
              <div style={{ paddingTop: 24, textAlign: "center", width: "100%", maxWidth: 448 }}>
                <span style={{ fontSize: 14, color: "#6b7c93" }}>
                  Don't have an account?{" "}
                  <a href="/onboarding" style={{ color: "rgb(84, 105, 212)", fontWeight: 600, textDecoration: "none" }}>
                    Sign up
                  </a>
                </span>
                <div style={{
                  paddingTop: 24,
                  paddingBottom: 24,
                  display: "flex",
                  justifyContent: "center",
                  gap: 24,
                  flexWrap: "wrap",
                }}>
                  <span><a href="#" style={{ fontSize: 13, color: "#8898aa", textDecoration: "none" }}>© 201.3 OFFLINE</a></span>
                  <span><a href="#" style={{ fontSize: 13, color: "#8898aa", textDecoration: "none" }}>101.1 ONLINE</a></span>
                  <span><a href="#" style={{ fontSize: 13, color: "#8898aa", textDecoration: "none" }}>101.6 ONLINE</a></span>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
};
