import type { NavLink } from "./NavLinks";

/**
 * The site menu, the same on every page, so a word always goes to the same
 * place. Statement, Scenario, Your share and Contribute are parts of the home
 * page; Promises, Your MP, People and Method are pages of their own. The home
 * page also shows short Promises and Method sections: while one is in view its
 * item lights up (`section`), but a click still opens the full page.
 */
export const SITE_LINKS: NavLink[] = [
  { href: "/#statement", label: "Statement" },
  { href: "/#scenario", label: "Scenario" },
  { href: "/#you", label: "Your share" },
  { href: "/promises", label: "Promises", section: "promises" },
  { href: "/mp", label: "Your MP" },
  { href: "/people", label: "People" },
  { href: "/#contribute", label: "Contribute" },
  { href: "/method", label: "Method", section: "method" },
];
