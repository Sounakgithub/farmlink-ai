import { useState } from "react";
import AppShell from "../../components/AppShell";
import CropForm from "../../components/CropForm";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Modal,
  Spinner,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useToast } from "../../context/ToastContext";
import { currency, cropIcon } from "../../lib/format";

export default function FarmerProducts() {
  const toast = useToast();

  // Only ever the logged-in farmer's own crops.
  const {
    data: products,
    setData: setProducts,
    loading,
    error,
    reload,
  } = useAsyncData(() => api.get("/products/mine"), { initialData: [] });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleCreate = async (payload) => {
    try {
      const data = await api.post("/products", payload);
      setProducts((current) => [data.product, ...current]);
      setShowForm(false);
      toast.success(`${data.product.cropName} is now listed.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpdate = async (payload) => {
    try {
      const data = await api.patch(`/products/${editing._id}`, payload);
      setProducts((current) =>
        current.map((p) => (p._id === data.product._id ? data.product : p))
      );
      setEditing(null);
      toast.success("Listing updated.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    setDeleteBusy(true);
    try {
      await api.delete(`/products/${deleting._id}`);
      setProducts((current) => current.filter((p) => p._id !== deleting._id));
      toast.success(`${deleting.cropName} removed.`);
      setDeleting(null);
    } catch (err) {
      toast.error(err.message);
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <AppShell
      title="My Crops"
      subtitle={`${products.length} listing${products.length === 1 ? "" : "s"}`}
      actions={
        <Button onClick={() => setShowForm(true)} className="whitespace-nowrap">
          + Add crop
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <Spinner label="Loading your crops…" />
      ) : products.length === 0 ? (
        <EmptyState
          title="No crops listed yet"
          description="Add your first crop and buyers will be able to find it in the marketplace right away."
          action={<Button onClick={() => setShowForm(true)}>Add your first crop</Button>}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <div
              key={product._id}
              className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-4xl">{cropIcon(product.cropName)}</span>

                <Badge
                  className={
                    product.quantity > 0
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }
                >
                  {product.quantity > 0 ? "In stock" : "Sold out"}
                </Badge>
              </div>

              <h3 className="mt-3 text-lg font-bold text-slate-900">
                {product.cropName}
              </h3>

              <div className="mt-3 flex-1 space-y-1.5 text-sm text-slate-600">
                <p>📦 {product.quantity} {product.unit} available</p>
                <p>📍 {product.location}</p>
              </div>

              <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-4">
                <div>
                  <span className="text-xl font-bold text-emerald-600">
                    {currency(product.pricePerKg)}
                  </span>
                  <span className="ml-1 text-sm text-slate-500">/ kg</span>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setEditing(product)}
                >
                  ✏️ Edit
                </Button>

                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => setDeleting(product)}
                >
                  🗑️ Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add a new crop 🌱"
        description="List your produce so buyers can order it directly."
      >
        <CropForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          submitLabel="List crop"
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.cropName || "crop"}`}
        description="Update the stock, price or location of this listing."
      >
        {editing && (
          <CropForm
            initial={{
              cropName: editing.cropName,
              quantity: String(editing.quantity),
              unit: editing.unit,
              location: editing.location,
              pricePerKg: String(editing.pricePerKg),
              image: editing.image || "",
            }}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
            submitLabel="Save changes"
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        busy={deleteBusy}
        title={`Delete ${deleting?.cropName}?`}
        message="This removes the listing from the marketplace. Crops that are part of an active order can't be deleted."
        confirmLabel="Delete listing"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </AppShell>
  );
}
