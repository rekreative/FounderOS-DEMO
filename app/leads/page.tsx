import FunnelPage from '../funnel/page';

// Wrapper page: /leads
// Reuses the funnel page UI but consumers can filter or view leads specifically later.
export default async function LeadsPage() {
  return <FunnelPage />;
}
