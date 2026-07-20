import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import Dashboard from '@/pages/dashboard';
import Setup from '@/pages/setup';
import Send from '@/pages/send';
import Mining from '@/pages/mining';
import Blocks from '@/pages/blocks';
import Ledger from '@/pages/ledger';
import BlockDetail from '@/pages/block-detail';
import Transactions from '@/pages/transactions';
import TransactionDetail from '@/pages/transaction-detail';
import Contracts from '@/pages/contracts';
import Privacy from '@/pages/privacy';
import Exchange from '@/pages/exchange';
import Contacts from '@/pages/contacts';
import OnRamp from '@/pages/onramp';
import Community from '@/pages/community';
import EmberSwap from '@/pages/emberswap';
import Tokens from '@/pages/tokens';
import TokenDetail from '@/pages/token-detail';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/setup" component={Setup} />
      <Route path="/send" component={Send} />
      <Route path="/mining" component={Mining} />
      <Route path="/ledger" component={Ledger} />
      <Route path="/blocks" component={Blocks} />
      <Route path="/blocks/:number" component={BlockDetail} />
      <Route path="/transactions" component={Transactions} />
      <Route path="/transactions/:hash" component={TransactionDetail} />
      <Route path="/contracts" component={Contracts} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/exchange" component={Exchange} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/onramp" component={OnRamp} />
      <Route path="/community" component={Community} />
      <Route path="/emberswap" component={EmberSwap} />
      <Route path="/tokens" component={Tokens} />
      <Route path="/tokens/:address" component={TokenDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
