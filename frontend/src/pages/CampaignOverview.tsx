import { CampaignCard } from "@/components/CampaignCard";
import { CapabilityStrip } from "@/components/CapabilityStrip";
import { useCampaignParam } from "@/hooks/useCampaignParam";

export default function CampaignOverview() {
  const { campaignAddress } = useCampaignParam();
  return (
    <div className="space-y-6">
      <CapabilityStrip campaignAddress={campaignAddress} />
      <CampaignCard address={campaignAddress} />
    </div>
  );
}
