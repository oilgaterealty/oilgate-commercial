import Walkthrough from './Walkthrough.jsx';
import Tenants from './Tenants.jsx';
import Comps from './Comps.jsx';
import { Tabs } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import Files from '../components/Files.jsx';
import Photos from '../components/Photos.jsx';
import Activity from '../components/Activity.jsx';
import { SellerPulse, AlertsCard } from '../components/Pulse.jsx';
import Dashboard from './Dashboard.jsx';
import Offers from './Offers.jsx';

export { SellerPulse, AlertsCard };

const TABS = [
  ['overview', 'Overview'],
  ['offers', 'Offers'],
  ['walkthrough', 'Walkthrough'],
  ['tenants', 'Tenants'],
  ['comps', 'Comps'],
  ['photos', 'Photos'],
  ['messages', 'Messages'],
  ['files', 'Files'],
  ['seller', 'Seller activity'],
];

// Close to the owner's page, minus his powers: no saving numbers, no invites, no settings, no strategy ideas.
export default function Realtor({ deal, me, member, preview, tab }) {
  const active = TABS.find(([k]) => k === tab)?.[0] || 'overview';
  return (
    <div>
      <Tabs tabs={TABS} active={active} base={preview ? `#/d/${deal.slug}/view/realtor` : `#/d/${deal.slug}`} />
      {active === 'overview' && <Dashboard deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'offers' && <Offers deal={deal} me={me} role="realtor" preview={preview} onlyShared={preview ? 'realtor' : undefined} />}
      {active === 'walkthrough' && <Walkthrough deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'tenants' && <Tenants deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'comps' && <Comps deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'messages' && <Messages deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'photos' && <Photos deal={deal} role="realtor" me={me} preview={preview} />}
      {active === 'files' && <Files deal={deal} role="realtor" me={me} title="Photos and documents" canShare allowShare preview={preview} />}
      {active === 'seller' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Activity deal={deal} title="What the seller has done" kinds={['view', 'interest', 'upload']} />
          <div className="space-y-6">
            <SellerPulse deal={deal} />
            {!preview && <AlertsCard topic={member?.ntfy_topic} who="You’ll get a push when someone messages you or the seller does something here." />}
          </div>
        </div>
      )}
    </div>
  );
}
