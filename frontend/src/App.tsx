import { BrowserRouter, Route, Routes } from "react-router-dom";

import { PageLayout } from "@/components/PageLayout";
import AdminPage from "@/pages/admin/AdminPage";
import AuditorPage from "@/pages/auditor/AuditorPage";
import CampaignLayout from "@/pages/CampaignLayout";
import CampaignOverview from "@/pages/CampaignOverview";
import PublicHome from "@/pages/PublicHome";
import RecipientPage from "@/pages/recipient/RecipientPage";

export default function App() {
  return (
    <BrowserRouter>
      <PageLayout>
        <Routes>
          <Route path="/" element={<PublicHome />} />
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

function NotFound() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">
        Page not found.
      </p>
    </div>
  );
}
