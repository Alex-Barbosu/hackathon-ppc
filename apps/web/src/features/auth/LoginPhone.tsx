import { PhoneFrame } from "../../components/phone/PhoneFrame";
import { PhoneScreen } from "../../components/phone/PhoneScreen";
import { Chip } from "../../components/ui";

// What a receipt looks like, shown before sign-in so the promise is concrete. Labelled as an example, not live data.
export function LoginPhone() {
  return (
    <PhoneFrame label="Example FileGrid receipt on a phone" tilt="right" className="[--phone-w:min(280px,calc((100dvh-300px)*0.47))] [@media(max-height:760px)]:hidden">
      <PhoneScreen
        eyebrow="Example receipt"
        title={<>Stored and <em>verified</em>.</>}
        status={<Chip tone="good">SHA-256 matches</Chip>}
        rows={[
          { label: "Category", value: "Outage record" },
          { label: "Storage", value: "S3" },
          { label: "SHA-256", value: <span className="font-mono">9f86d0…0a08</span> },
          { label: "Encrypted", value: "No" },
          { label: "Fallback", value: "PostgreSQL" },
        ]}
        footer={<p className="text-[11px] leading-4 text-faint">Every download is re-hashed as it streams. A mismatch stops it with a 422.</p>}
      />
    </PhoneFrame>
  );
}
