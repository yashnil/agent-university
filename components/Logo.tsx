import Image from "next/image";
import Link from "next/link";
import styles from "./Logo.module.css";

/**
 * The header lockup: mark (48px) + 12px + the wordmark.
 *
 * The wordmark is always lowercase, one word, with "mem" italic. Both halves are --fg; the italic
 * is the only difference. The mark's #13161E ground is baked into the PNG, so this may only ever
 * sit on --bg — never on a panel, where the square edge would show.
 */
export default function Logo() {
  return (
    <Link href="/" className={styles.lockup} aria-label="swarmem home">
      <Image src="/logo.png" alt="" width={48} height={48} priority className={styles.mark} />
      <span className={styles.wordmark}>
        swar<em>mem</em>
      </span>
    </Link>
  );
}
