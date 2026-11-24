import Walkthrough from './Walkthrough.jsx';
import Tenants from './Tenants.jsx';
import Comps from './Comps.jsx';
import { Tabs } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import Files from '../components/Files.jsx';
import Photos from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import Activity from '../components/Activity.jsx';
import { SellerPulse, AlertsCard } from '../components/Pulse.jsx';
import Dashboard from './Dashboard.jsx';
import Offers from './Offers.jsx';

export { SellerPulse, AlertsCard };

const TABS = [
  ['overview', 'Overview'],
  ['offers', 'Offers'],
  ['walkthrough', 'Walkthrough'],
  ['photos', 'Photos'],
  ['tenants', 'Tenants'],
  ['comps', 'Comps'],
  ['messages', 'Messages'],
  ['files', 'Files'],
  ['seller', 'Seller activity'],
];

// Close to the buyer's page, minus his powers: no saving numbers, no invites, no settings.
// "readable" lifts small text to phone-friendly sizes (see index.css).
export default function Realtor({ deal, me, member, preview, tab }) {
  const active = TABS.find(([k]) => k === tab)?.[0] || 'overview';
  return (
    <div className="readable">
      <Tabs tabs={TABS} active={active} base={preview ? `#/d/${deal.slug}/view/realtor` : `#/d/${deal.slug}`} />
      {active === 'overview' && <Dashboard deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'offers' && <Offers deal={deal} me={me} role="realtor" preview={preview} onlyShared={preview ? 'realtor' : undefined} />}
      {active === 'walkthrough' && <Walkthrough deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'photos' && (
        <div className="space-y-5">
          <UnitGallery deal={deal} me={me} role="realtor" preview={preview} />
          <Photos deal={deal} role="realtor" me={me} preview={preview} />
        </div>
      )}
      {active === 'tenants' && <Tenants deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'comps' && <Comps deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'messages' && <Messages deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'files' && <Files deal={deal} role="realtor" me={me} title="Documents and files" canShare allowShare preview={preview} />}
      {active === 'seller' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr_340px]">
          <Activity deal={deal} title="What the seller has done" actors={['seller']} empty="The seller hasn’t opened or done anything yet." />
          <Activity deal={deal} title="What the buyer has done" actors={['owner']} empty="Nothing from the buyer’s side yet." />
          <div className="space-y-6">
            <SellerPulse deal={deal} />
            {!preview && <AlertsCard topic={member?.ntfy_topic} who="You get a push when someone messages you or the seller does something here." />}
          </div>
        </div>
      )}
    </div>
  );
}
