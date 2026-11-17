# Smart templates: draft text, version 3 (after review)

**Status:** IMPLEMENTED 2026-11-16 in `static/js/src/config-fill.js` (approved by the user; the pe-subnet wording was dropped by user decision).
**Source:** findings of product `test`, v1.3 draft, plus the EOLM findings of the other products (all read-only).
64 findings in the draft, 52 already covered by a smart template (35 EAPM, 14 SECR, 3 "VPC MULTIPLE").
The 12 templates below cover the findings that still carry Wiz's raw English text.

## Review log (what was wrong in version 2, and what changed)

| # | Problem found in v2 | Fix in v3 |
|---|---|---|
| 1 | Singular wording ("החוק X מאפשר") breaks when the finding lists several rules. In this report CSPM-007 has 6 rules, CSPM-004 has 2 machines, CSPM-006 has 8 subnets. | Every description now opens with a plural-neutral lead and a colon list: "זוהו חוקי firewall ...: `<RESOURCES>`". It reads correctly for 1 or many. |
| 2 | Template 3 said "בכל פרוטוקול". The rule detail only says "all ports", so that was an unsupported claim. | Removed. |
| 3 | Template 4 said the rule opens all five ports. The rule flags "one or more" of them. | Now "לפחות אחד מהפורטים". |
| 4 | Template 1 mentioned only 0.0.0.0/0. The rule also covers `::/0` (IPv6). | Added `::/0`. |
| 5 | Template 10 described protected-mode as blocking outside connections "when no password is set". Real behaviour: it applies when no password **and** no explicit `bind` are set. | Corrected. |
| 6 | Template 8 asserted privilege escalation to root. The only source is Wiz's rule detail ("kernel exploitation vectors"). | Softened to what the source supports, and kept the "to verify" flag. Also added `modprobe -r`, because `install ... /bin/false` does not unload a module that is already loaded. |
| 7 | Template 7: removing Editor from the default service account can break other VMs that rely on it. Also `--scopes` is not the main control, IAM roles are. | Added a check for other users of the account and an IAM-roles line. |
| 8 | Template 12 (EOLM) was wrong about the data. The count in the old description is the number of Wiz items, not the number of components listed, and components can be libraries (`pkg:go/...`) or products (Ubuntu, Edge). Several subscriptions are possible. Some lines carry ", EOL date YYYY-MM-DD". | The description now uses the listed components, caps the list at 8 with "ועוד N", supports several subscriptions, and the recs separate libraries from OS / runtimes / applications. |
| 9 | Commands mixed with Hebrew mid-sentence (templates 8, 9) can scramble in the RTL PDF. | Every command now ends its line, nothing Hebrew after it. |
| 10 | Numbered lists in this file suggested numbers in the finding. | Stated below: the real recs are plain lines, like Private Key. |
| 11 | Placeholders inside commands (`<ZONE>`, `<PORT>`) looked like "missing data". | Defined below: only `<UPPERCASE>` values in the **תיאור** are filled from the finding; those inside commands are examples the team fills in. |
| 12 | Templates 4 and 5 match the existing VPC merge pattern (`VPC firewall rule(s) should restrict .+ access`). | Added the interaction note below. |
| 13 | Redis without a password was left open, but the recs never said to check whether someone already used it. | Added a "check for compromise" rec (templates 9 and 11). |
| 14 | IAP / Bastion advice without the one detail teams get wrong: IAP needs its own source range open. | Added `35.235.240.0/20` in template 4. |

## How to read this file

Each template has four parts, all in Hebrew:

| Part | Meaning |
|---|---|
| **תיאור** | What was found, filled in from the finding's data. |
| **השפעה** | What an attacker can do because of this. Written so a team lead understands it. |
| **המלצות** | Concrete steps in order. The real finding gets them as plain lines with no numbers, like `[SECR] Private Key`. |
| **נשלף מהממצא** | Which values come from the finding. |

Rules for the values:
- `<RESOURCES>`, `<REGION>`, `<SUBSCRIPTIONS>`, `<COUNT>`, `<COMPONENTS>` in the **תיאור** are filled from the finding's technical details.
  If one of them is missing, the popup leaves that finding alone (same rule as EAPM / SECR).
- `<RESOURCES>` is the "Resource:" line. If Wiz shortened it ("ועוד 3..."), the text keeps "ועוד 3".
- Placeholders inside **commands** (`<PORT>`, `<ZONE>`, `<NEW_SA>`...) are examples for the team to fill in. They are not "missing data". When the finding has exactly one resource, `<SUBNET>` / `<INSTANCE>` are filled with its name.
- The title stays exactly as Wiz wrote it, so product memory and exception rules still match by title. Matching is case-insensitive on the trimmed title.
- Exception line, used wherever an exception is realistic: **"אם יש צורך עסקי בכך, יש לציין את הסיבה ונשקול החרגה."**

**Interaction with the VPC merge (important):** the import already merges two or more VPC findings on the same firewall rule into "VPC firewall rules should restrict MULTIPLE accesses". Templates 4 and 5 have titles of the form "should restrict ... access", so if one rule trips both checks it is merged and the MULTIPLE template applies instead. Templates 1, 2 and 3 are never merged.

---

# A. VPC firewall (5 templates)

### 1. VPC firewall rule should not allow access from any IP
- **תיאור:** זוהו חוקי firewall המאפשרים גישה מכל כתובת IP (0.0.0.0/0 או ::/0): `<RESOURCES>`. כלומר, כל כתובת באינטרנט יכולה לנסות להתחבר למשאבים שהחוקים חושפים, בפורטים שהחוקים מאפשרים.
- **השפעה:** פתיחה לכל האינטרנט חושפת את השירות לסריקות אוטומטיות, לניסיונות ניחוש סיסמאות ולניצול פגיעויות ידועות. כל תוקף בעולם יכול לנסות, בלי גישה מוקדמת לרשת הארגון.
- **המלצות:**
  1. יש להחליף את מקור הגישה בטווחי ה-IP שבאמת צריכים גישה (כתובות הארגון, VPN או ה-Load Balancer).
  2. אם השירות מיועד לציבור (למשל אתר HTTP/HTTPS), יש לוודא שהוא מאחורי Load Balancer / WAF, ולהגביל את החוק לפורטים הנדרשים בלבד.
  3. אם יש צורך עסקי בכך, יש לציין את הסיבה ונשקול החרגה.
- **נשלף מהממצא:** שמות החוקים.
- **הערה למבקר:** בדוח הזה מסומן גם `allow-http-https-argocs-server`, שנראה כמו חשיפה מכוונת, ולכן שורת ההחרגה רלוונטית.

### 2. VPC firewall rule should allow access to specific private networks only
- **תיאור:** זוהו חוקי firewall המאפשרים גישה מכל הטווחים הפרטיים (10.0.0.0/8, 172.16.0.0/12 ו-192.168.0.0/16): `<RESOURCES>`. כלומר, הגישה פתוחה מכל מכונה ברשת הפנימית ולא רק ממכונות שצריכות אותה.
- **השפעה:** אם מכונה כלשהי ברשת נפרצת, התוקף יכול לגשת ממנה למשאבים האלה ולהתקדם הלאה ברשת (תנועה לרוחב). ככל שהטווח רחב יותר, יותר מכונות יכולות לשמש נקודת פתיחה לתוקף.
- **המלצות:**
  1. יש לבדוק אילו מכונות או subnets צריכים גישה בפועל, ולהגדיר אותם בלבד כמקור (source ranges, network tags או service accounts).
  2. אם נדרשת גישה מכל הרשת הפנימית, יש לציין את הסיבה ונשקול החרגה.
- **נשלף מהממצא:** שמות החוקים.

### 3. VPC firewall rule should allow access over specific ports only
- **תיאור:** זוהו חוקי firewall המאפשרים גישה בכל הפורטים: `<RESOURCES>`. כלומר, הגישה פתוחה גם לפורטים שהשירות לא צריך.
- **השפעה:** כל שירות שרץ על המכונות, כולל שירותי ניהול ובסיסי נתונים שלא נועדו לגישה מבחוץ, נגיש למי שמגיע לחוק. תוקף יכול למצוא שירות חלש או לא מוגן ולהיכנס דרכו.
- **המלצות:**
  1. יש לבדוק באילו פורטים השירות באמת מקבל חיבורים, ולהגדיר בחוק רק אותם (`--allow tcp:<PORT>`).
  2. יש להגביל גם את המקור (source ranges) למי שצריך גישה.
  3. אם יש צורך עסקי בפתיחת כל הפורטים, יש לציין את הסיבה ונשקול החרגה.
- **נשלף מהממצא:** שמות החוקים.

### 4. VPC firewall rule should restrict access over uncommon ports
The Wiz title is misleading: the rule detail lists database and RDP ports, so the text says so.
- **תיאור:** זוהו חוקי firewall המאפשרים גישה לפחות לאחד מהפורטים של בסיסי נתונים ושל RDP: 1433 (SQL Server), 1521 (Oracle), 3306 (MySQL), 3389 (RDP) ו-5432 (PostgreSQL): `<RESOURCES>`.
- **השפעה:** פורטים אלה מיועדים לבסיסי נתונים ולשולחן עבודה מרוחק, ואינם אמורים להיות חשופים לרשת רחבה. תוקף שמגיע אליהם יכול לנסות ניחוש סיסמאות, לנצל פגיעויות ולהגיע ישירות לנתונים או לשליטה מלאה במכונה.
- **המלצות:**
  1. יש לסגור את הפורטים האלה, או להגביל אותם רק למכונות וכתובות שצריכות אותם.
  2. לגישה של אנשים (תחזוקה, ניהול) יש להעדיף VPN, IAP או Bastion במקום פתיחת הפורט. אם משתמשים ב-IAP, יש להתיר בחוק רק את טווח ה-IP שלו: 35.235.240.0/20.
  3. אם יש צורך עסקי בכך, יש לציין את הסיבה ונשקול החרגה.
- **נשלף מהממצא:** שמות החוקים. הפורטים כתובים בטקסט הקבוע, כי Wiz כותב אותם בשורת "Rule Detail".

### 5. VPC firewall rule should restrict VNC access (TCP - ports 5500, 5800 and 5900)
- **תיאור:** זוהו חוקי firewall המאפשרים גישה לפורטי VNC (TCP 5500, 5800 ו-5900): `<RESOURCES>`. VNC הוא פרוטוקול לשליטה גרפית מרחוק במכונה.
- **השפעה:** VNC נותן שליטה מלאה במסך ובמקלדת של המכונה. הוא בדרך כלל מוגן רק בסיסמה פשוטה, ולעיתים התעבורה אינה מוצפנת. מי שנכנס דרכו שולט במכונה כאילו ישב מולה.
- **המלצות:**
  1. יש לסגור את פורטים 5500, 5800 ו-5900 בחוקים.
  2. לגישה מרחוק יש להשתמש ב-IAP TCP forwarding, ב-SSH tunnel או ב-VPN.
  3. אם VNC חייב להישאר פתוח, יש להגביל אותו לכתובות ספציפיות, לציין את הסיבה ונשקול החרגה.
- **נשלף מהממצא:** שמות החוקים.

---

# B. Other CSPM (2 templates)

### 6. VPC subnet should have Private Google Access enabled
- **תיאור:** ב-subnets הבאים באזור `<REGION>` לא מופעל Private Google Access: `<RESOURCES>`. מכונות ב-subnet שאין להן כתובת IP חיצונית לא יכולות לגשת לשירותי Google (כמו Cloud Storage ו-API של GCP) דרך הרשת הפרטית.
- **השפעה:** כשאין Private Google Access, הצוותים נאלצים לתת למכונות כתובת חיצונית או להעביר את התעבורה דרך האינטרנט. זה מרחיב את החשיפה לאינטרנט, ומקשה להגביל את הגישה ל-API של Google לערוץ פרטי בלבד.
- **המלצות:**
  1. יש להפעיל Private Google Access בכל subnet שיש בו מכונות שפונות ל-API של Google, באמצעות הפקודה: `gcloud compute networks subnets update <SUBNET> --region=<REGION> --enable-private-ip-google-access`
  2. אם ב-subnet אין מכונות שצריכות גישה ל-API של Google, יש לציין זאת ונשקול החרגה.
- **נשלף מהממצא:** שמות ה-subnets והאזור. אם יש כמה אזורים, התיאור כותב "באזורים" ומפרט אותם.

### 7. Compute instance should not use the default Compute Engine service account with full API access
- **תיאור:** זוהו מכונות שרצות עם ה-service account של ברירת המחדל של Compute Engine, כשה-access scope שלהן הוא Full access to all Cloud APIs: `<RESOURCES>`.
- **השפעה:** אם תוקף משיג הרצת קוד על המכונה (למשל דרך פגיעות באפליקציה), הוא יכול לבקש מהמכונה token של ה-service account ולפעול מול שירותי GCP בהרשאות שלו. בפרויקטים רבים יש לחשבון ברירת המחדל הרשאת Editor על כל הפרויקט, ולכן פריצה של מכונה אחת עלולה להפוך לפריצה של הפרויקט כולו.
- **המלצות:**
  1. יש ליצור service account ייעודי לכל מכונה (או סוג מכונה) עם ההרשאות IAM שהיא צריכה בלבד.
  2. יש להחליף אותו במכונה (היא צריכה להיות כבויה) ולהגדיר scopes מצומצמים, באמצעות הפקודה: `gcloud compute instances set-service-account <INSTANCE> --zone=<ZONE> --service-account=<NEW_SA> --scopes=<MINIMAL_SCOPES>`
  3. יש לבדוק אילו הרשאות יש לחשבון ברירת המחדל בפרויקט, ולהסיר ממנו Editor רק אחרי שמוודאים שאף מכונה אחרת לא נשענת עליו.
  4. אם יש צורך עסקי בהרשאה המלאה, יש לציין את הסיבה ונשקול החרגה.
- **נשלף מהממצא:** שמות המכונות. ה-zone לא מופיע בממצא (רק ה-region), ולכן נשאר `<ZONE>` בפקודה כדוגמה.

---

# C. HSPM, host configuration (4 templates)

### 8. Ensure CopyFail2 and DirtyFrag vulnerable kernel modules are disabled
- **תיאור:** במכונות הבאות לא נחסמה האפשרות לטעון את מודולי הליבה esp4, esp6 ו-rxrpc, שבהם יש פגיעויות (CopyFail2 ו-DirtyFrag): `<RESOURCES>`.
- **השפעה:** פגיעות בליבה (kernel) ניתנת לניצול ממכונה שהתוקף כבר נכנס אליה, למשל דרך אפליקציה פגיעה או סיסמה גנובה. ניצול כזה עלול לתת לו שליטה רחבה בהרבה מההרשאות שקיבל בכניסה.
- **המלצות:**
  1. יש לעדכן את ה-kernel לגרסה שבה הפגיעויות תוקנו.
  2. עד העדכון, יש לחסום את טעינת המודולים באמצעות קובץ תחת `/etc/modprobe.d` עם השורות: install esp4 /bin/false, install esp6 /bin/false, install rxrpc /bin/false
  3. אם המודולים כבר טעונים, יש להסיר אותם באמצעות הפקודה: modprobe -r esp4 esp6 rxrpc
  4. esp4 ו-esp6 משמשים ל-IPsec, ולכן לפני החסימה יש לוודא שהמכונה לא משתמשת ב-IPsec.
- **נשלף מהממצא:** שמות המכונות.
- **לאימות:** הטקסט מבוסס רק על שורת "Rule Detail" של Wiz ועל שם הכלל. לא בדקתי את תיאור ה-CVE, ויש לאשר אותו לפני שמוסיפים את התבנית.

### 9. Check if CUPS browsed was installed and was active at least once
- **תיאור:** במכונות הבאות הותקן השירות cups-browsed (שירות לגילוי מדפסות ברשת), והוא פעל לפחות פעם אחת: `<RESOURCES>`.
- **השפעה:** השירות מקבל הודעות מהרשת, ונמצאו בו פגיעויות להרצת קוד מרחוק (למשל CVE-2024-47176). לשרת אין צורך בהדפסה, ולכן זהו משטח תקיפה מיותר שמאפשר לתוקף ברשת להריץ פקודות על המכונה.
- **המלצות:**
  1. יש להשבית את השירות באמצעות הפקודה: systemctl disable --now cups-browsed
  2. יש להסיר את החבילה (`apt remove cups-browsed`, או הפקודה המקבילה בהפצה).
  3. מאחר שהשירות פעל, יש לבדוק שלא נעשה בו שימוש חריג, למשל מדפסות לא מוכרות שהוגדרו במכונה.
  4. אם השירות נדרש, יש לעדכן אותו לגרסה האחרונה ולחסום UDP 631 ב-firewall, ולציין את הסיבה ונשקול החרגה.
- **נשלף מהממצא:** שמות המכונות.

### 10. Ensure Redis is in 'protected-mode'
- **תיאור:** בשרתי Redis במכונות הבאות מצב protected-mode כבוי: `<RESOURCES>`. מצב זה חוסם חיבורים מכתובות חיצוניות כשלא הוגדרו סיסמה ו-`bind` מפורש.
- **השפעה:** בלי protected-mode ובלי הגבלות רשת, כל מי שמגיע לפורט 6379 יכול לקרוא, לשנות ולמחוק את כל הנתונים ב-Redis. ידועה גם שיטת תקיפה שמנצלת את פקודת `CONFIG` כדי לכתוב קובץ למכונה (למשל מפתח SSH) ולקבל גישה אליה.
- **המלצות:**
  1. יש להפעיל `protected-mode yes` ולהגביל את `bind` לכתובת פנימית.
  2. יש לחסום את פורט 6379 ב-firewall, ולאפשר אותו רק למכונות שצריכות לגשת ל-Redis.
  3. אם ה-Redis הוא חלק ממוצר של יצרן, יש לוודא מול היצרן לפני שינוי, לציין זאת ונשקול החרגה.
- **נשלף מהממצא:** שמות המכונות.
- **הערה למבקר:** המכונה שסומנה בדוח היא `cma-checkpoint-mangement` (שרת ניהול של Check Point), שבו Redis כנראה מגיע מהיצרן, ולכן שורה 3 רלוונטית.

### 11. Ensure Redis is configured with a strong password
- **תיאור:** שרתי Redis במכונות הבאות פועלים ללא סיסמה (לא הוגדרו `requirepass`, `user` או `aclfile`), ולכן כל מי שמגיע אליהם יכול להתחבר בלי הזדהות: `<RESOURCES>`.
- **השפעה:** כל מי שמגיע לפורט 6379 מקבל גישה מלאה לנתונים ולפקודות הניהול, בלי להזדהות. אפשר לגנוב או למחוק נתונים, ולעיתים להשתמש בפקודות הניהול כדי להשתלט על המכונה.
- **המלצות:**
  1. יש להגדיר סיסמה חזקה (`requirepass`), או משתמשי ACL ייעודיים לכל אפליקציה.
  2. יש להגביל את הגישה לפורט 6379 למכונות שצריכות אותו בלבד.
  3. מאחר שהשירות היה פתוח, יש לבדוק שלא נכתבו במכונה מפתחות SSH או משימות cron לא מוכרים, ושלא נוספו או נמחקו מפתחות ב-Redis.
  4. אם ה-Redis הוא חלק ממוצר של יצרן, יש לוודא מול היצרן לפני שינוי, לציין זאת ונשקול החרגה.
- **נשלף מהממצא:** שמות המכונות.

---

# D. EOLM, end of life (1 template)

Data in the finding (checked against EOLM findings of four products): the technical details hold one line per component (`- Linux Ubuntu.`, `- OpenSSL.`, `- pkg:python/boto.`, sometimes with `, EOL date 2025-01-31`), then `Subscription: a, b`. The machines are **not** in the finding, so the text does not mention machines.

### 12. רכיבים בסוף חיים (End of Life)
- **תיאור:** במנויים `<SUBSCRIPTIONS>` זוהו `<COUNT>` רכיבים שהגיעו לסוף תמיכה (End of Life): `<COMPONENTS>`.
  - `<COUNT>` is the number of component lines, not the old Wiz item count.
  - `<COMPONENTS>` lists at most 8 names, then "ועוד N". The full list stays in the technical details.
  - One subscription is written "במנוי".
- **השפעה:** רכיב שהגיע לסוף תמיכה לא מקבל עוד עדכוני אבטחה. פגיעויות חדשות שיתגלו בו לא יתוקנו ויישארו ניתנות לניצול לאורך זמן, ובדרך כלל מתפרסמות פרטיהן ברבים.
- **המלצות:**
  1. ספריות (רכיבים שמופיעים כ-`pkg:...`): יש לעדכן את התלות בקוד לגרסה נתמכת ולבנות מחדש את ה-image או את האפליקציה.
  2. מערכות הפעלה, runtime ואפליקציות (למשל Ubuntu, Python, Edge): יש לשדרג לגרסה נתמכת, או לתכנן מיגרציה בהתאם ללוח הזמנים של היצרן.
  3. אם לא ניתן לשדרג כעת, יש לבודד את הרכיב (הגבלת גישת רשת) ולהקשיח אותו עד לשדרוג.
  4. אם יש צורך עסקי בכך, יש לציין את תוכנית המיגרציה ונשקול החרגה זמנית.
- **נשלף מהממצא:** המנויים, מספר הרכיבים ושמותיהם.

---

# Still open for the user

1. **Templates 8, 9, 10, 11:** they rely on Wiz's rule detail and public knowledge, not on your environment. Please confirm the facts, especially the CopyFail2 / DirtyFrag description in template 8.
2. **"הערה למבקר" lines:** they flag exception candidates (the Check Point Redis host) and stay in this file only, not in the finding text. Say so if you want them in the finding.
3. **Naming:** if you want a rule's title shown differently in the dropdown, say so. By default the dropdown shows Wiz's title and the finding keeps it.
