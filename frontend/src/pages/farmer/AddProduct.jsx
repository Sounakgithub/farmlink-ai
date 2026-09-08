import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import CropForm from "../../components/CropForm";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";

export default function AddProduct() {
  const navigate = useNavigate();
  const toast = useToast();

  const handleSubmit = async (payload) => {
    try {
      const data = await api.post("/products", payload);
      toast.success(`${data.product.cropName} is now listed.`);
      navigate("/farmer/products");
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <AppShell
      title="Add a new crop"
      subtitle="List your produce for buyers on the marketplace"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <CropForm
          onSubmit={handleSubmit}
          onCancel={() => navigate("/farmer/products")}
          submitLabel="List crop"
        />
      </div>
    </AppShell>
  );
}
