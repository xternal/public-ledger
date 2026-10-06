import { getSeed } from "@/lib/data";
import { Ledger } from "@/components/Ledger";

export default function Home() {
  return <Ledger seed={getSeed()} />;
}
