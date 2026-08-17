import FunnelPage from '../funnel/page';

// Wrapper page: /clients
// Reuses the existing funnel page UI for now but exposes a clean /clients URL.
export default async function ClientsPage() {
  return <FunnelPage />;
}
