import TopBarSkeleton from "@/components/TopBarSkeleton";
import PageLoader from "@/components/PageLoader";

export default function CatalogLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <PageLoader fullScreen label="Loading the product catalogue…" />
      </main>
    </div>
  );
}
