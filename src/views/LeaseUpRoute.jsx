import { lazy, Suspense } from 'react';
import { Empty } from '../components/Shell.jsx';
const LeaseUp = lazy(() => import('./LeaseUp.jsx'));

export default function LeaseUpRoute(props) {
  return <Suspense fallback={<Empty>Loading lease-up…</Empty>}><LeaseUp {...props} /></Suspense>;
}
