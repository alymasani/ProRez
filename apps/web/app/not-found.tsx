import Link from "next/link";
import { Telescope } from "lucide-react";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      icon={Telescope}
      title="Page not found"
      description="The page or record you're looking for doesn't exist in the demo data."
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to overview</Link>
        </Button>
      }
    />
  );
}
