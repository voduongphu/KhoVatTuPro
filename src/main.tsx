import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { StorageService } from './services/storage';
import './index.css';

const Bootstrap: React.FC = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    StorageService.init()
      .catch((err) => console.error('Storage init error:', err))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-3 text-slate-300 font-sans">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs font-medium tracking-wide">Đang khởi tạo dữ liệu kho vận...</span>
      </div>
    );
  }

  return <App />;
};

createRoot(document.getElementById('root')!).render(<Bootstrap />);
