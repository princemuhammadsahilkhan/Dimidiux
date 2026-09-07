import React from 'react';

export default function Header({ activeTab, setActiveTab }) {
  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'objective', label: 'Objective' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <header class="fixed top-0 left-0 right-0 z-50 bg-surface/80 backdrop-blur-xl select-none">
      <div className="h-14 w-full px-space-base flex items-center justify-between">
        {/* Left section: macOS Window controls & Title */}
        <div className="flex items-center gap-space-sm w-44">
          <div className="flex items-center gap-space-xs">
            <span className="w-3 h-3 rounded-full bg-[#FF5F57] shadow-sm inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-[#FEBC2E] shadow-sm inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-[#28C840] shadow-sm inline-block"></span>
          </div>
          <span className="font-title-sm text-title-sm text-on-surface font-semibold tracking-tight ml-space-xs">
            EVO
          </span>
        </div>

        {/* Center section: Nav tab bar */}
        <nav className="flex items-center p-space-2xs bg-surface-container rounded-lg">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`px-space-md py-space-2xs rounded-lg transition-all font-label-md text-label-md ${
                  isActive
                    ? 'bg-surface-container-lowest text-on-surface shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right section: Profile Avatar */}
        <div className="flex items-center justify-end w-44">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-on-primary text-[18px]">
              person
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
