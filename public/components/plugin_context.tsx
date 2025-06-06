import React, { createContext, useContext } from 'react';
import { AssetService } from '../services/fetch_assets';

interface PluginContextValue {
  assetService: AssetService;
}

const PluginContext = createContext<PluginContextValue | null>(null);

export const PluginProvider: React.FC<{
  value: PluginContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
);

export const usePluginContext = () => {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePluginContext must be used within a PluginProvider');
  }
  return context;
};