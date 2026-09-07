import React, { useState } from 'react';

export default function SettingsScreen() {
  const [autonomy, setAutonomy] = useState('ask'); // 'ask' | 'routine' | 'independent'
  const [filesPermission, setFilesPermission] = useState(true);
  const [appsPermission, setAppsPermission] = useState(false);

  const autonomyOptions = [
    {
      id: 'ask',
      label: 'Ask before doing anything',
      icon: 'front_hand',
    },
    {
      id: 'routine',
      label: 'Handle routine work',
      icon: 'tune',
    },
    {
      id: 'independent',
      label: 'Work independently',
      icon: 'bolt',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto w-full py-space-3xl px-space-base">
      <div className="mb-space-2xl">
        <h1 className="font-title-lg text-title-lg text-on-surface tracking-tight">
          Settings
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">
          System preferences for agent behavior, security access, and display.
        </p>
      </div>

      <div className="flex flex-col gap-space-xl">
        {/* Section 1: Autonomy */}
        <section className="flex flex-col gap-space-sm">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium px-space-xs">
            Autonomy
          </span>
          <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden p-space-sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-xs" id="autonomy-group">
              {autonomyOptions.map((opt) => {
                const isActive = autonomy === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAutonomy(opt.id)}
                    className={`autonomy-btn flex flex-col items-center justify-center p-space-base rounded-lg text-center transition-all duration-150 ${
                      isActive
                        ? 'bg-surface-container-high text-on-surface'
                        : 'hover:bg-surface-container-low text-on-surface-variant'
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-[20px] mb-space-xs ${
                        isActive ? 'text-primary' : 'text-secondary'
                      }`}
                    >
                      {opt.icon}
                    </span>
                    <span className="font-title-sm text-title-sm font-medium leading-snug">
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Section 2: Permissions */}
        <section className="flex flex-col gap-space-sm">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium px-space-xs">
            Permissions
          </span>
          <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden divide-y divide-surface-container">
            {/* Files permission */}
            <div className="flex items-center justify-between px-space-base py-space-md">
              <div className="flex items-center gap-space-md">
                <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface">
                  <span className="material-symbols-outlined text-[18px]">
                    folder
                  </span>
                </div>
                <span className="font-title-sm text-title-sm text-on-surface font-medium">
                  Files
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={filesPermission}
                onClick={() => setFilesPermission(!filesPermission)}
                className={`perm-toggle relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                  filesPermission ? 'bg-primary' : 'bg-surface-variant'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-on-primary shadow ring-0 transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
                    filesPermission ? 'translate-x-5' : 'translate-x-0'
                  }`}
                ></span>
              </button>
            </div>

            {/* Applications permission */}
            <div className="flex items-center justify-between px-space-base py-space-md">
              <div className="flex items-center gap-space-md">
                <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface">
                  <span className="material-symbols-outlined text-[18px]">
                    apps
                  </span>
                </div>
                <span className="font-title-sm text-title-sm text-on-surface font-medium">
                  Applications
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={appsPermission}
                onClick={() => setAppsPermission(!appsPermission)}
                className={`perm-toggle relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                  appsPermission ? 'bg-primary' : 'bg-surface-variant'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-on-primary shadow ring-0 transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
                    appsPermission ? 'translate-x-5' : 'translate-x-0'
                  }`}
                ></span>
              </button>
            </div>
          </div>
        </section>

        {/* Section 3: Appearance */}
        <section className="flex flex-col gap-space-sm">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium px-space-xs">
            Appearance
          </span>
          <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-base flex items-center justify-between">
            <div className="flex items-center gap-space-md">
              <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface">
                <span className="material-symbols-outlined text-[18px]">
                  light_mode
                </span>
              </div>
              <span className="font-title-sm text-title-sm text-on-surface font-medium">
                Light
              </span>
            </div>
            <div className="flex items-center gap-space-xs text-primary">
              <span className="font-label-md text-label-md font-medium">
                Active
              </span>
              <span className="material-symbols-outlined text-[18px]">
                check
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
