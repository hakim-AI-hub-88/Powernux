// Icônes de l'application : Font Awesome (free).
import logoUrl from "../assets/logo.png";

export { FontAwesomeIcon as Icon } from "@fortawesome/react-fontawesome";

// Logo officiel Powernux (src/assets/logo.png).
export const Logo = ({ size = 32 }: { size?: number }) => (
  <img src={logoUrl} alt="Powernux" width={size} height={size} style={{ objectFit: "contain" }} draggable={false} />
);
