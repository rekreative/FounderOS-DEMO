import { ClientResultsDashboard } from '@/components/ClientResultsDashboard';

export default function ClientResultsPage({ params }: { params: { clientId: string } }) {
  return <ClientResultsDashboard clientId={params.clientId} />;
}
