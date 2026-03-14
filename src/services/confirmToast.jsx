import toast from "react-hot-toast";

const buttonBaseStyle = {
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 600,
  padding: "10px 16px",
};

export function confirmToast({
  title,
  description = "",
  confirmLabel = "Aceptar",
  cancelLabel = "Cancelar",
  confirmTone = "primary",
}) {
  return new Promise((resolve) => {
    const id = toast.custom(
      (t) => (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e8edf5",
            borderRadius: "18px",
            boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)",
            color: "#10233d",
            maxWidth: "420px",
            padding: "18px",
            width: "calc(100vw - 32px)",
          }}
        >
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>
            {title}
          </div>
          {description ? (
            <div
              style={{
                color: "#5f6c7b",
                fontSize: "14px",
                lineHeight: 1.45,
                marginBottom: "16px",
                whiteSpace: "pre-line",
              }}
            >
              {description}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button
              type="button"
              style={{
                ...buttonBaseStyle,
                background: "#eef2f7",
                color: "#334155",
              }}
              onClick={() => {
                toast.dismiss(t.id);
                resolve(false);
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              style={{
                ...buttonBaseStyle,
                background: confirmTone === "danger" ? "#dc2626" : "#228be6",
                color: "#fff",
              }}
              onClick={() => {
                toast.dismiss(t.id);
                resolve(true);
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ),
      {
        duration: Infinity,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }
    );

    void id;
  });
}
