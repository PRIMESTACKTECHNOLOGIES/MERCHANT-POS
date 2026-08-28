import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/api";

export const LoginPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Add a small artificial delay for better UX
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const data = await login(username, password);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      
      // Check if user needs onboarding (mock check)
      // For demo purposes, we'll just redirect to dashboard, 
      // but in a real app, we'd check a flag.
      // navigate("/onboarding"); 
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left Side - Branding & Illustration */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-50 relative overflow-hidden items-center justify-center p-12">
        <div className="absolute inset-0 z-0">
           <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.1),rgba(255,255,255,0))]" />
           <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-100/40 rounded-full blur-3xl animate-blob" />
           <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-100/40 rounded-full blur-3xl animate-blob animation-delay-2000" />
        </div>
        
        <div className="relative z-10 max-w-lg text-center">
           <div className="mb-8 flex justify-center">
             <div className="w-16 h-16 bg-white rounded-2xl shadow-xl shadow-blue-500/10 flex items-center justify-center text-blue-600">
               <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
             </div>
           </div>
           <h2 className="text-3xl font-bold text-gray-900 tracking-tight mb-4">Manage your business with confidence.</h2>
           <p className="text-lg text-gray-500 leading-relaxed">
             The all-in-one platform for modern merchants. Track sales, manage inventory, and process payments securely.
           </p>
           
           <div className="mt-12 grid grid-cols-2 gap-4">
             <div className="p-4 bg-white/60 backdrop-blur-sm rounded-xl border border-white/50 shadow-sm">
               <div className="text-2xl font-bold text-gray-900 mb-1">99.9%</div>
               <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Uptime</div>
             </div>
             <div className="p-4 bg-white/60 backdrop-blur-sm rounded-xl border border-white/50 shadow-sm">
               <div className="text-2xl font-bold text-gray-900 mb-1">$2B+</div>
               <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Processed</div>
             </div>
           </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24 bg-white">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="text-center lg:text-left mb-10">
            <div className="lg:hidden flex justify-center mb-6">
               <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                 <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
               </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome Back</h1>
            <p className="mt-2 text-sm text-gray-500">
              New here? <a href="/onboarding" className="font-medium text-blue-600 hover:text-blue-500 transition-colors">Create an account</a>
            </p>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <button className="flex items-center justify-center px-4 py-2.5 border border-gray-200 rounded-xl shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Google
              </button>
              <button className="flex items-center justify-center px-4 py-2.5 border border-gray-200 rounded-xl shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                <svg className="h-5 w-5 mr-2" fill="currentColor" viewBox="0 0 24 24"><path d="M13.601 2.326A4.499 4.499 0 0017.504 0a4.496 4.496 0 00-4.797 4.797c0 .381.011.595.011.595s2.459.206 4.192-3.066zM19.111 15.376c-.846 1.192-1.742 2.359-3.097 2.385-1.341.026-1.769-.795-3.303-.795-1.536 0-2.016.77-3.305.821-1.312.051-2.309-1.308-3.149-2.513-1.718-2.487-3.033-7.025-1.272-10.077 1.705-2.956 4.672-2.906 5.86-1.076.626.963 1.517.963 2.605.963 1.088 0 2.877-1.319 4.839-1.127.871.038 3.361.346 4.949 2.653-4.084 1.986-3.414 7.608.873 8.767z"/></svg>
                Apple
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with email</span>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 animate-fade-in">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm text-red-700 font-medium">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">Username</label>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  required
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                  placeholder="Enter username (admin)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">Password</label>
                <input
                  type="password"
                  inputMode="text"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input id="remember-me" name="remember-me" type="checkbox" className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700">Remember me</label>
                </div>
                <div className="text-sm">
                  <a href="#" className="font-medium text-blue-600 hover:text-blue-500 transition-colors">Forgot password?</a>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={`w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all ${loading ? 'opacity-70 cursor-wait' : ''}`}
              >
                {loading ? (
                   <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                     <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                     <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                   </svg>
                ) : "Sign in"}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-100">
               <div className="flex justify-center gap-6 text-xs text-gray-400">
                 <a href="#" className="hover:text-gray-600 transition-colors">Terms of Service</a>
                 <a href="#" className="hover:text-gray-600 transition-colors">Privacy Policy</a>
                 <a href="#" className="hover:text-gray-600 transition-colors">Help Center</a>
               </div>
               <div className="mt-4 text-center text-xs text-gray-300">
                 &copy; 2024 MerchantPortal Inc.
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
