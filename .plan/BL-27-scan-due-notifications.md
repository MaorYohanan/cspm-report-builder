# BL-27 — Scan-Due Push Notifications

**Complete Refined Specification**

---

## Overview

**Feature:** Real-time monitoring of pipeline scan deadlines with automatic notifications when products become newly overdue.

**Why:** The Pipeline tab shows overdue products but requires a manual page reload to detect newly overdue items, meaning consultants can miss a scan deadline between sessions.

**Effort:** Medium

**Tier:** Tier 2 (High Value, Moderate Work)

**Files:**
- `static/js/src/pipeline.js` (modified — add polling logic, badge updates, toast notifications)
- `index.html` (modified — add badge element to Pipeline sidebar tab)
- `static/css/src/pipeline.css` (modified — badge styling, if needed)

**Branch:** `feature/scan-due-notifications`

---

## Approved Design Decisions

### Question 1: Technical Approach
**Decision:** Option A — Client-side polling with `setInterval`

**Rationale:**
- Simpler implementation, no new backend routes required
- Works with any server setup (no SSE requirements)
- Sufficient for scan deadline monitoring (deadlines are measured in days/weeks)
- Reuses existing `GET /api/pipeline` endpoint

### Question 2: Polling Interval
**Decision:** 10 minutes (600,000ms)

**Rationale:**
- Scan deadlines are measured in days/weeks, so 10-minute checks are sufficient
- Not too aggressive on server resources
- Good balance between responsiveness and resource usage

### Question 3: Notification UI Placement
**Decision:** Option D — Combination of sidebar badge + toast notification

**Rationale:**
- Sidebar badge on Pipeline tab for persistent visibility (e.g., "Pipeline (2)" or badge indicator)
- Toast popup notification for immediate attention when new overdue items are detected
- Best of both worlds: persistent reminder + immediate alert

---

## Implementation Plan

### Part A — Client-Side Polling Logic

**File:** `static/js/src/pipeline.js`

1. **Add module-level state variables** at the top of `pipeline.js`:
   ```javascript
   let _overdueCheckInterval = null;
   let _lastKnownOverdueCount = 0;
   ```

2. **Create `_initOverdueMonitoring()` function:**
   ```javascript
   _initOverdueMonitoring: function() {
       var self = this;
       
       // Clear any existing interval
       if (_overdueCheckInterval) {
           clearInterval(_overdueCheckInterval);
       }
       
       // Get initial baseline count (current overdue products)
       self._updateOverdueCount();
       
       // Poll every 10 minutes (600,000ms)
       _overdueCheckInterval = setInterval(function() {
           self._checkForNewOverdue();
       }, 600000);
   },
   ```

3. **Create `_updateOverdueCount()` function** (sets baseline without showing notification):
   ```javascript
   _updateOverdueCount: function() {
       var self = this;
       fetch('/api/pipeline')
           .then(function(resp) { return resp.json(); })
           .then(function(data) {
               var overdueCount = data.filter(function(p) { 
                   return p.status === 'overdue'; 
               }).length;
               
               _lastKnownOverdueCount = overdueCount;
               self._updateBadge(overdueCount);
           })
           .catch(function(err) {
               console.error('Failed to fetch pipeline status for overdue monitoring:', err);
           });
   },
   ```

4. **Create `_checkForNewOverdue()` function** (detects changes and shows toast):
   ```javascript
   _checkForNewOverdue: function() {
       var self = this;
       fetch('/api/pipeline')
           .then(function(resp) { return resp.json(); })
           .then(function(data) {
               var currentOverdueCount = data.filter(function(p) { 
                   return p.status === 'overdue'; 
               }).length;
               
               // Only show toast if count INCREASED
               if (currentOverdueCount > _lastKnownOverdueCount) {
                   var newCount = currentOverdueCount - _lastKnownOverdueCount;
                   var message = newCount === 1 
                       ? 'מוצר אחד נכנס לסטטוס איחור בסריקה' 
                       : newCount + ' מוצרים נכנסו לסטטוס איחור בסריקה';
                   showToast(message, 'warning');
               }
               
               // Always update badge and baseline
               _lastKnownOverdueCount = currentOverdueCount;
               self._updateBadge(currentOverdueCount);
           })
           .catch(function(err) {
               console.error('Failed to check for new overdue products:', err);
           });
   },
   ```

5. **Create `_updateBadge()` function:**
   ```javascript
   _updateBadge: function(count) {
       var badge = document.getElementById('pipeline-overdue-badge');
       if (!badge) return;
       
       if (count > 0) {
           badge.textContent = count;
           badge.style.display = 'inline-block';
       } else {
           badge.style.display = 'none';
       }
   },
   ```

6. **Hook into existing `init()` or page load:**
   Find the existing `init` method in `pipeline.js` and add:
   ```javascript
   init: function() {
       var self = this;
       // ... existing initialization code ...
       
       // Start overdue monitoring
       self._initOverdueMonitoring();
   },
   ```

7. **Add cleanup on tab switch** (optional, to pause monitoring when Pipeline tab is not active):
   If a tab-switch handler exists, consider pausing the interval when the user navigates away from the Pipeline tab and resuming when they return. This is optional — monitoring can run continuously regardless of active tab.

---

### Part B — UI Elements (Badge)

**File:** `index.html`

1. **Add badge element to Pipeline sidebar tab:**
   
   Find the Pipeline/לוח בקרה tab button (currently around line 71-73):
   ```html
   <button class="sidebar-item" role="tab" aria-selected="false" aria-controls="panel-dashboard" id="tab-dashboard" data-i18n-title="לוח בקרה" title="לוח בקרה">
     <span class="sidebar-item-icon icon-dashboard">▦</span> <span data-i18n="לוח בקרה">לוח בקרה</span>
   </button>
   ```
   
   Change to:
   ```html
   <button class="sidebar-item" role="tab" aria-selected="false" aria-controls="panel-dashboard" id="tab-dashboard" data-i18n-title="לוח בקרה" title="לוח בקרה">
     <span class="sidebar-item-icon icon-dashboard">▦</span> 
     <span data-i18n="לוח בקרה">לוח בקרה</span>
     <span class="pipeline-overdue-badge" id="pipeline-overdue-badge" style="display:none;">0</span>
   </button>
   ```

2. **Increment JS cache buster** in the `<script>` tag for `pipeline.js`:
   Find the line:
   ```html
   <script type="module" src="static/js/src/pipeline.js?v=XXX"></script>
   ```
   Increment `v=XXX` to `v=XXX+1`.

---

### Part C — CSS Styling (Badge)

**File:** `static/css/src/pipeline.css` (or the appropriate CSS file, likely `static/css/src/styles.css`)

1. **Add badge styles:**
   ```css
   /* Overdue scan notification badge */
   .pipeline-overdue-badge {
       display: inline-block;
       margin-inline-start: 6px;
       padding: 2px 6px;
       font-size: 0.75rem;
       font-weight: 600;
       color: white;
       background-color: var(--danger-color, #e74c3c);
       border-radius: 10px;
       line-height: 1;
       vertical-align: middle;
   }
   ```

2. **Run `python3 build_css.py`** to regenerate the concatenated CSS file.

---

## Behavior Specification

### Initial Page Load
1. When the user first loads the page (or refreshes), `_initOverdueMonitoring()` is called
2. `_updateOverdueCount()` fetches the current pipeline data and sets `_lastKnownOverdueCount` as the baseline
3. The badge is updated to show the current overdue count (if any)
4. **No toast is shown on initial load** — only the badge is updated
5. A 10-minute polling interval is started

### During Polling (Every 10 Minutes)
1. `_checkForNewOverdue()` fetches the current pipeline data
2. Counts how many products have `status === 'overdue'`
3. **If count increased:**
   - Show a toast notification: "מוצר אחד נכנס לסטטוס איחור בסריקה" (singular) or "N מוצרים נכנסו לסטטוס איחור בסריקה" (plural)
   - Toast type: `warning` (amber/orange color)
4. **If count decreased or stayed the same:**
   - Update badge silently (no toast)
5. Update `_lastKnownOverdueCount` to the new count
6. Update badge display

### Badge Behavior
- **When overdue count > 0:** Badge is visible, shows the count number in white text on red background
- **When overdue count = 0:** Badge is hidden (`display: none`)
- Badge updates on every poll, regardless of whether a toast is shown
- Badge shows the **current total overdue count**, not just newly overdue items

### Toast Notification Behavior
- **Only shown when count increases** (detecting newly overdue products)
- Toast message is in Hebrew (RTL-aware)
- Toast type: `warning` (uses existing toast system in the codebase)
- Single vs plural message handling (1 product vs N products)

### Edge Cases
1. **Network error during poll:** Silently log error to console, do not update count or badge, do not show error toast (avoid spam)
2. **User manually refreshes Pipeline tab:** Badge reflects current state immediately (via `_updateOverdueCount()` which doesn't show toast)
3. **Multiple tabs open:** Each tab runs its own polling independently — acceptable trade-off for simplicity
4. **Count decreases (product no longer overdue):** Badge updates, no toast (consultants don't need alerts when things improve)
5. **Page stays open for days:** Polling continues indefinitely — acceptable (scan deadlines change slowly)

---

## Testing & Verification

### Manual Testing Steps

1. **Initial state verification:**
   - Open the Pipeline page
   - Check if there are any overdue products in the current data
   - Verify badge shows correct count (or is hidden if count = 0)
   - Verify no toast appears on initial load

2. **Simulate a product becoming overdue:**
   - **Option A (time travel):** Temporarily modify `_pipeline_status()` in `backend/routes/pipeline.py` to artificially mark a product as overdue
   - **Option B (database edit):** Manually update a product's `last_published_at` date in the database to be more than N months ago (based on scan frequency)
   - Wait 10 minutes (or temporarily reduce polling interval to 30 seconds for testing)
   - Verify toast appears with correct message
   - Verify badge increments

3. **Simulate count decrease:**
   - Publish a new version for an overdue product (or revert the test change from step 2)
   - Wait for next poll cycle
   - Verify badge decrements
   - Verify **no toast appears**

4. **Badge styling verification:**
   - Check badge appears correctly in RTL layout (margin on correct side)
   - Verify red background, white text, rounded corners
   - Verify badge aligns properly with sidebar item text

5. **Persistence across page reloads:**
   - With some products overdue, refresh the page
   - Verify badge shows correct count immediately
   - Verify no toast on reload

6. **Network error handling:**
   - Use browser DevTools to block network requests to `/api/pipeline`
   - Wait for next poll cycle
   - Verify no error toast appears (silent failure)
   - Restore network, wait for next poll
   - Verify badge updates correctly

---

## Code Review Checklist

Before merging, verify:
- [ ] Polling interval is exactly 600,000ms (10 minutes)
- [ ] Toast only appears when count **increases** (not on decrease or initial load)
- [ ] Badge shows current total, not delta
- [ ] No memory leaks (interval is cleared if re-initialized)
- [ ] Hebrew toast messages are correct (singular vs plural)
- [ ] Badge is hidden when count = 0
- [ ] Network errors are logged to console but don't spam the user
- [ ] JS cache buster was incremented
- [ ] CSS was rebuilt with `build_css.py`
- [ ] No console errors on page load
- [ ] Badge alignment works in RTL layout

---

## Success Criteria

1. ✅ Polling runs automatically every 10 minutes after page load
2. ✅ Badge shows current overdue count on Pipeline sidebar tab
3. ✅ Badge is hidden when no products are overdue
4. ✅ Toast notification appears **only** when new products become overdue
5. ✅ Toast message is in Hebrew with correct singular/plural handling
6. ✅ Badge updates silently when count decreases
7. ✅ Network errors are handled gracefully without user-facing error messages
8. ✅ No new backend routes required (reuses `GET /api/pipeline`)
9. ✅ Badge styling matches project design system (red background, white text, RTL-aware)
10. ✅ No performance degradation (polling is lightweight, only 1 request per 10 minutes)

---

## Notes

- **No localStorage dependency:** The baseline overdue count is stored in a module-level variable (`_lastKnownOverdueCount`), not in localStorage. This means each page load starts fresh with the current state as the baseline, which is the correct behavior (we don't want a toast on page load even if products were overdue yesterday).

- **No tab-switch optimization required:** While we could pause polling when the user switches to a different tab and resume on return, this optimization is not necessary for a 10-minute interval. The overhead is negligible.

- **Future enhancement opportunity:** If SSE or WebSocket support is added to the backend in the future, this client-side polling can be replaced with a server-push mechanism. The badge update and toast logic can remain unchanged; only the data-fetching mechanism would change.

- **Compatibility with existing scan polling:** The existing `_pollStatus()` function polls during active scans. This new overdue monitoring runs independently and does not interfere with active scan status updates.

- **Multi-language support:** The toast messages are currently hardcoded in Hebrew. When multi-language support (BL-29, Milestone 3.3) is implemented, these strings should be added to the `i18n.js` translation dictionary with the key prefix `pipeline_overdue_*`.

---

## Git Workflow

1. Create branch: `git checkout -b feature/scan-due-notifications`
2. Implement all changes per spec above
3. Test manually (all verification steps)
4. Run backend tests: `python -m pytest tests/ -x -q`
5. Run `code-reviewer` agent on modified files
6. Fix any issues flagged
7. Commit with message:
   ```
   feat(pipeline): scan-due push notifications with badge and toast
   
   - Add 10-minute polling for pipeline overdue status changes
   - Show badge on Pipeline sidebar tab with current overdue count
   - Toast notification when new products become overdue
   - Silent badge update when count decreases
   - Graceful network error handling
   
   Implements BL-27 (Tier 2)
   
   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
   ```
8. Push and merge to main
9. Update `memory/roadmap-status.md` to `✅ merged to main`

---

**End of Specification**
