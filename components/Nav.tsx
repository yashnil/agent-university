"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Record" },
  { href: "/arena", label: "Arena" },
];

/** Global navigation. Arena needs a way back that does not depend on knowing the logo links home. */
export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="siteNav" aria-label="Primary">
      {LINKS.map((link, i) => (
        <span key={link.href}>
          {i > 0 ? <span className="sep" aria-hidden="true">·&nbsp;</span> : null}
          <Link href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
            {link.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
