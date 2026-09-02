import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// PERFORMANCE: Lazy load heavy imports to prevent startup freeze
// import { initializeAIToolHandler } from "./lib/ai-tool-handler";
// import { useAttackState } from "./lib/attack-state-store";

// Global error handler to catch ALL errors
window.addEventListener('error', (event) => {
  console.error('═══════════════════════════════════════════════════════');
  console.error('🔴 GLOBAL ERROR CAUGHT');
  console.error('═══════════════════════════════════════════════════════');
  console.error('Message:', event.message);
  console.error('Filename:', event.filename);
  console.error('Line:', event.lineno, 'Column:', event.colno);
  console.error('Error object:', event.error);
  console.error('Stack:', event.error?.stack);
  console.error('═══════════════════════════════════════════════════════');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('═══════════════════════════════════════════════════════');
  console.error('🔴 UNHANDLED PROMISE REJECTION');
  console.error('═══════════════════════════════════════════════════════');
  console.error('Reason:', event.reason);
  console.error('Promise:', event.promise);
  if (event.reason?.stack) {
    console.error('Stack:', event.reason.stack);
  }
  console.error('═══════════════════════════════════════════════════════');
});

console.log('[main.tsx] Global error handlers installed');

// Apply the last renderer-side preference before React paints the workspace.
// The settings store still reconciles with Electron after mount, but this
// removes the dark-to-light flash that made light mode feel delayed.
function applyInitialTheme() {
  let isDarkMode = true;

  try {
    const persisted = window.localStorage.getItem('app-settings');
    const parsed = persisted ? JSON.parse(persisted) : null;
    const storedDarkMode = parsed?.state?.settings?.darkMode;
    if (typeof storedDarkMode === 'boolean') {
      isDarkMode = storedDarkMode;
    }
  } catch {
    // Keep the safe dark default when local storage is unavailable/corrupt.
  }

  document.documentElement.classList.toggle('dark', isDarkMode);
  document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light';
}

applyInitialTheme();

// Wait for BOTH DOM and Electron API to be ready
function initApp() {
  const root = document.getElementById("root");
  
  if (!root) {
    console.log("[Init] Root element not found, retrying...");
    setTimeout(initApp, 50);
    return;
  }
  
  try {
    console.log("[Init] Mounting React app...");
    createRoot(root).render(<App />);
    
    // Remove loading screen once React has rendered
    setTimeout(() => {
      const loading = document.getElementById("loading");
      if (loading) {
        loading.style.opacity = "0";
        loading.style.transition = "opacity 0.3s";
        setTimeout(() => loading.remove(), 300);
      }
    }, 100);
  } catch (error) {
    console.error("[Init] Failed to mount React:", error);
    const loading = document.getElementById("loading");
    if (loading) {
      // SECURITY: Use textContent to prevent XSS
      const container = document.createElement('div');
      container.style.textAlign = 'center';
      container.style.color = '#ef4444';
      
      const icon = document.createElement('img');
      icon.src = './osecbox-icon.png';
      icon.alt = 'OsecBox';
      icon.width = 72;
      icon.height = 72;
      icon.style.display = 'block';
      icon.style.margin = '0 auto 18px';
      icon.style.borderRadius = '18px';
      icon.style.boxShadow = '0 0 28px rgba(139, 92, 246, 0.4)';
      container.appendChild(icon);
      
      const title = document.createElement('div');
      title.style.fontSize = '24px';
      title.style.marginBottom = '16px';
      title.textContent = 'Failed to load app';
      
      const message = document.createElement('div');
      message.style.fontSize = '14px';
      message.textContent = error instanceof Error ? error.message : String(error);
      
      const button = document.createElement('button');
      button.textContent = 'Reload';
      button.style.marginTop = '20px';
      button.style.padding = '10px 20px';
      button.style.background = '#3b82f6';
      button.style.border = 'none';
      button.style.borderRadius = '4px';
      button.style.color = 'white';
      button.style.cursor = 'pointer';
      button.onclick = () => location.reload();
      
      container.appendChild(title);
      container.appendChild(message);
      container.appendChild(button);
      
      loading.innerHTML = '';
      loading.appendChild(container);
    }
  }
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // CRITICAL OPTIMIZATION: Start immediately
    initApp();
  });
} else {
  // CRITICAL OPTIMIZATION: Start immediately
  initApp();
}
