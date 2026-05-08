import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";

import { PageLayout } from "@/components/PageLayout";
import AdminPage from "@/pages/admin/AdminPage";
import AuditorPage from "@/pages/auditor/AuditorPage";
import CampaignLayout from "@/pages/CampaignLayout";
import CampaignOverview from "@/pages/CampaignOverview";
import Home from "@/pages/Home";
import RecipientPage from "@/pages/recipient/RecipientPage";
import Step1Basics from "@/pages/wizard/Step1Basics";
import Step2Recipients from "@/pages/wizard/Step2Recipients";
import Step3Auditor from "@/pages/wizard/Step3Auditor";
import Step4Review from "@/pages/wizard/Step4Review";
import Step5Deploy from "@/pages/wizard/Step5Deploy";
import WizardLayout from "@/pages/wizard/WizardLayout";

export default function App() {
  return (
    <BrowserRouter>
      <PageLayout>
        <Routes>
          {/* V7 home + public-first detail routes */}
          <Route path="/" element={<Home />} />
          <Route path="/c/:address" element={<LegacyCampaignRedirect />} />

          {/* V7 deployment wizard — 5 nested steps under /wizard. */}
          <Route path="/wizard" element={<WizardLayout />}>
            <Route index element={<Navigate to="basics" replace />} />
            <Route path="basics" element={<Step1Basics />} />
            <Route path="recipients" element={<Step2Recipients />} />
            <Route path="auditor" element={<Step3Auditor />} />
            <Route path="review" element={<Step4Review />} />
            <Route path="deploy" element={<Step5Deploy />} />
          </Route>

          {/* V6 routes preserved so existing /campaign/:address links keep
              working alongside the new /c/:address dispatcher. */}
          <Route path="/campaign/:address" element={<CampaignLayout />}>
            <Route index element={<CampaignOverview />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="me" element={<RecipientPage />} />
            <Route path="audit" element={<AuditorPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </PageLayout>
    </BrowserRouter>
  );
}

function LegacyCampaignRedirect() {
  const { address } = useParams();
  if (!address) {
    return <Navigate to="/" replace />;
  }
  return <Navigate to={`/campaign/${address}`} replace />;
}

function NotFound() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">
        Page not found.
      </p>
    </div>
  );
}
