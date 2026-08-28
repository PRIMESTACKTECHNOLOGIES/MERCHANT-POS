import { useNavigate } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { Sidebar } from "../components/Sidebar";
import { ProfileMenu } from "../components/ProfileMenu";
import { NotificationMenu } from "../components/NotificationMenu";
import { SettingsMenu } from "../components/SettingsMenu";

interface Props {
  children: ReactNode;
}

export const DashboardLayout = ({ children }: Props) => {
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="dashboard-root font-sans text-main bg-app flex h-screen overflow-hidden">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <main className="dashboard-main flex-1 flex flex-col relative h-full overflow-y-auto">
        <header className="dashboard-header sticky top-0 z-30 flex items-center justify-between px-4 lg:px-10 h-16 lg:h-20 bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm">
          {/* Mobile Menu Button */}
          <button 
            className="lg:hidden mr-4 p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            onClick={() => setIsSidebarOpen(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Left side: Logo & Search */}
          <div className="header-left flex items-center gap-6 flex-1">
             <div className="logo hidden lg:block mr-4">
                <h2 className="text-xl font-bold text-gray-800 tracking-tight">POS Portal</h2>
             </div>
             <div className="search-bar relative w-full max-w-md group">
               <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 transition-colors group-focus-within:text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
               <input 
                 type="text" 
                 placeholder="Search transactions, terminals, batches..." 
                 className="w-full pl-10 pr-4 py-2.5 bg-gray-50/50 border border-transparent rounded-xl text-sm focus:bg-white focus:border-blue-200 focus:ring-4 focus:ring-blue-50/50 transition-all duration-200 outline-none placeholder-gray-400"
               />
             </div>
          </div>

          {/* Right side: Actions & Profile */}
          <div className="header-actions flex items-center gap-4">
            <div className="icons flex items-center gap-2">
              {/* Notifications */}
              <NotificationMenu />
              
              {/* Settings */}
              <SettingsMenu />
            </div>
            
            {/* User Profile */}
          <div className="profile-dropdown">
            <ProfileMenu />
          </div>
        </div>
      </header>
      <section className="dashboard-content flex-1 p-4 lg:p-8 max-w-[1600px] w-full mx-auto animate-fade-in">{children}</section>
    </main>
  </div>
);
};
