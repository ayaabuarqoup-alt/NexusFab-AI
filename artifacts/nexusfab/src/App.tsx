import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Factory } from 'lucide-react';
import { useGetSession, getGetSessionQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { Shell } from '@/components/shell';
import { ErrorState, Sk, sessionQuery, onAuthBroadcast } from '@/components/common';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Jobs from '@/pages/jobs';
import Production from '@/pages/production';
import Quality from '@/pages/quality';
import Machines from '@/pages/machines';
import Copilot from '@/pages/copilot';
import Account from '@/pages/account';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <span className="num text-5xl font-semibold text-primary">404</span>
      <p className="text-sm text-muted-foreground">{t('notFound')}</p>
      <Link href="/" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" data-testid="link-home">{t('backHome')}</Link>
    </div>
  );
}

function Gate() {
  const qc = useQueryClient();
  const s = useGetSession({ query: sessionQuery });
  useEffect(() => onAuthBroadcast(() => { qc.resetQueries({ predicate: (q) => q.queryKey[0] !== getGetSessionQueryKey()[0] }); qc.invalidateQueries({ queryKey: getGetSessionQueryKey() }); }), [qc]);
  const tenant = s.data?.authenticated ? `${s.data.factory}::${s.data.userId ?? ''}` : '';
  const prevTenant = useRef<string | null>(null);
  useEffect(() => {
    if (prevTenant.current && prevTenant.current !== tenant) qc.resetQueries({ predicate: (q) => q.queryKey[0] !== getGetSessionQueryKey()[0] });
    prevTenant.current = tenant;
  }, [tenant, qc]);
  if (s.isLoading) return (
    <div className="grid min-h-[100dvh] place-items-center bg-background">
      <div className="flex flex-col items-center gap-3"><Factory className="h-6 w-6 animate-pulse text-primary" /><Sk className="h-2 w-32" /></div>
    </div>
  );
  if (s.isError) return <div className="mx-auto max-w-md p-8"><ErrorState error={s.error} onRetry={() => s.refetch()} /></div>;
  if (!s.data?.authenticated) return <Login />;
  return (
    <Shell key={tenant}>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/jobs" component={Jobs} />
          <Route path="/production" component={Production} />
          <Route path="/quality" component={Quality} />
          <Route path="/machines" component={Machines} />
          <Route path="/copilot" component={Copilot} />
          <Route path="/account" component={Account} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Gate />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
