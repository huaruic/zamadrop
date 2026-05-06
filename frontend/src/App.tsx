import { BrowserRouter, Route, Routes } from "react-router-dom";

import { PageLayout } from "@/components/PageLayout";
import AdminPage from "@/pages/admin/AdminPage";
import AuditorPage from "@/pages/auditor/AuditorPage";
import CampaignDetail from "@/pages/CampaignDetail";
import CampaignLayout from "@/pages/CampaignLayout";
import CampaignOverview from "@/pages/CampaignOverview";
import Home from "@/pages/Home";
import RecipientPage from "@/pages/recipient/RecipientPage";

export default function App() {
  return (
    <BrowserRouter>
      <PageLayout>
        <Routes>
          {/* V7 home + role-aware detail routes */}
          <Route path="/" element={<Home />} />
          <Route path="/c/:address" element={<CampaignDetail />} />

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

function NotFound() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">
        Page not found.
      </p>
    </div>
  );
}
