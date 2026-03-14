import { useCallback, useEffect, useRef } from "react";

function useOverlayBack(isOpen, onClose, overlayKey) {
  const pushedRef = useRef(false);
  const skipNextPopRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!isOpen || pushedRef.current) return undefined;

    const nextState = {
      ...(window.history.state || {}),
      __overlayKey: overlayKey,
    };
    window.history.pushState(nextState, "", window.location.href);
    pushedRef.current = true;

    return undefined;
  }, [isOpen, overlayKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handlePopState = () => {
      if (skipNextPopRef.current) {
        skipNextPopRef.current = false;
        return;
      }

      if (!pushedRef.current) return;
      pushedRef.current = false;
      onClose();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onClose]);

  const closeOverlay = useCallback(() => {
    if (typeof window === "undefined") {
      onClose();
      return;
    }

    if (pushedRef.current && window.history.state?.__overlayKey === overlayKey) {
      pushedRef.current = false;
      skipNextPopRef.current = true;
      onClose();
      window.history.back();
      return;
    }

    onClose();
  }, [onClose, overlayKey]);

  return closeOverlay;
}

export default useOverlayBack;
