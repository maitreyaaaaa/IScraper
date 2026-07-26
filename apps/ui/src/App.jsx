import { useCallback, useEffect, useLayoutEffect, useState, canonicalizeLegacyHashRoute, canonicalizeUnknownPath, getRouteFromLocation, rememberPendingExtensionConnect, rememberPendingSave, resetPageScroll, ROUTE_PATHS, ROUTE_TITLES } from './AppShared.jsx';
import Dashboard from './dashboard/Dashboard.jsx';
import AdminSupportPage from './pages/AdminSupportPage.jsx';
import HelpCenterPage from './pages/HelpCenterPage.jsx';
import HowToUsePage from './pages/HowToUsePage.jsx';
import Landing from './pages/Landing.jsx';
import LegalPage from './pages/LegalPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PricingPage from './pages/PricingPage.jsx';

export default function App() {
  const [route, setRoute] = useState(() => {
    rememberPendingSave();
    rememberPendingExtensionConnect();
    return getRouteFromLocation();
  });

  const navigate = useCallback((nextRoute) => {
    const routeName = ROUTE_PATHS[nextRoute] ? nextRoute : 'landing';
    setRoute(routeName);
    window.history.pushState({}, ROUTE_TITLES[routeName], ROUTE_PATHS[routeName]);
    document.title = ROUTE_TITLES[routeName];
    resetPageScroll();
  }, []);

  useLayoutEffect(() => {
    resetPageScroll();
    const frame = window.requestAnimationFrame(resetPageScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [route]);

  useEffect(() => {
    document.title = ROUTE_TITLES[route] || 'IScraper';
  }, [route]);

  useEffect(() => {
    const onRouteChange = () => {
      rememberPendingSave();
      rememberPendingExtensionConnect();
      const nextRoute = getRouteFromLocation();
      setRoute(nextRoute);
      canonicalizeLegacyHashRoute();
      canonicalizeUnknownPath();
    };
    canonicalizeLegacyHashRoute();
    canonicalizeUnknownPath();
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('hashchange', onRouteChange);
    };
  }, []);

  if (route === 'app') return <Dashboard onBack={() => navigate('landing')} onOpenLogin={() => navigate('login')} onOpenHowTo={() => navigate('how-to-use')} />;
  if (route === 'login') return <LoginPage onBack={() => navigate('landing')} onOpenApp={() => navigate('app')} />;
  if (route === 'pricing') return <PricingPage onBack={() => navigate('landing')} onOpenApp={() => navigate('app')} onOpenHelp={() => navigate('help')} />;
  if (route === 'how-to-use') return <HowToUsePage onBack={() => navigate('landing')} onOpenApp={() => navigate('app')} />;
  if (route === 'terms') return <LegalPage type="terms" onBack={() => navigate('landing')} />;
  if (route === 'privacy') return <LegalPage type="privacy" onBack={() => navigate('landing')} />;
  if (route === 'security') return <LegalPage type="security" onBack={() => navigate('landing')} />;
  if (route === 'admin') return <AdminSupportPage onBack={() => navigate('landing')} />;
  if (route === 'data-deletion') return <LegalPage type="dataDeletion" onBack={() => navigate('landing')} />;
  if (route === 'cookies') return <LegalPage type="cookies" onBack={() => navigate('landing')} />;
  if (route === 'help') return <HelpCenterPage onBack={() => navigate('landing')} onOpenApp={() => navigate('app')} onOpenHowTo={() => navigate('how-to-use')} />;
  return (
    <Landing
      onOpenApp={() => navigate('app')}
      onOpenLogin={() => navigate('login')}
      onOpenPricing={() => navigate('pricing')}
      onOpenHowTo={() => navigate('how-to-use')}
      onOpenTerms={() => navigate('terms')}
      onOpenPrivacy={() => navigate('privacy')}
      onOpenHelp={() => navigate('help')}
      onOpenSecurity={() => navigate('security')}
      onOpenDataDeletion={() => navigate('data-deletion')}
      onOpenCookies={() => navigate('cookies')}
    />
  );
}
