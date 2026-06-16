// Application State
const state = {
    releaseNotes: [], // raw entries from API
    flatItems: [],     // flattened list of all updates with date & id
    activeCategory: 'ALL',
    searchQuery: '',
    feedUrl: '',
    isFallbackActive: false
};

// DOM Elements
const DOM = {
    loadingState: document.getElementById('loading-state'),
    errorState: document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    notesTimeline: document.getElementById('notes-timeline'),
    emptyState: document.getElementById('empty-state'),
    
    // Stats
    statReleases: document.getElementById('stat-releases'),
    statFeatures: document.getElementById('stat-features'),
    statIssues: document.getElementById('stat-issues'),
    statSync: document.getElementById('stat-sync'),
    
    // Actions
    btnRefresh: document.getElementById('btn-refresh'),
    btnSettings: document.getElementById('btn-settings'),
    btnRetry: document.getElementById('btn-retry'),
    statusText: document.getElementById('status-text'),
    statusDot: document.querySelector('.status-indicator .status-dot'),
    footerSourceLink: document.getElementById('footer-source-link'),
    
    // Controls
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    categoryPills: document.getElementById('category-pills'),
    
    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    feedUrlInput: document.getElementById('feed-url-input'),
    fallbackAlert: document.getElementById('fallback-alert'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnCancelSettings: document.getElementById('btn-cancel-settings'),
    btnResetFeed: document.getElementById('btn-reset-feed'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    
    // Toasts
    toastContainer: document.getElementById('toast-container')
};

// Category styling config
const CATEGORY_CONFIG = {
    'Feature': { class: 'tag-feature', icon: 'fa-wand-magic-sparkles', cardClass: 'card-feature' },
    'Issue': { class: 'tag-issue', icon: 'fa-triangle-exclamation', cardClass: 'card-issue' },
    'Change': { class: 'tag-changed', icon: 'fa-pen-to-square', cardClass: 'card-changed' },
    'Changed': { class: 'tag-changed', icon: 'fa-pen-to-square', cardClass: 'card-changed' },
    'Breaking': { class: 'tag-issue', icon: 'fa-circle-exclamation', cardClass: 'card-issue' },
    'Announcement': { class: 'tag-announcement', icon: 'fa-bullhorn', cardClass: 'card-announcement' },
    'Deprecation': { class: 'tag-deprecation', icon: 'fa-clock-rotate-left', cardClass: 'card-deprecation' },
    'Deprecated': { class: 'tag-deprecation', icon: 'fa-clock-rotate-left', cardClass: 'card-deprecation' },
    'Beta': { class: 'tag-changed', icon: 'fa-flask', cardClass: 'card-changed' },
    'GA': { class: 'tag-feature', icon: 'fa-circle-check', cardClass: 'card-feature' },
    'Update': { class: 'tag-default', icon: 'fa-circle-info', cardClass: 'card-default' }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    const savedUrl = localStorage.getItem('bigquery_feed_url');
    if (savedUrl) {
        state.feedUrl = savedUrl;
        DOM.feedUrlInput.value = savedUrl;
    }
    
    // Event Listeners
    DOM.btnRefresh.addEventListener('click', () => fetchNotes(true));
    DOM.btnRetry.addEventListener('click', () => fetchNotes(false));
    DOM.searchInput.addEventListener('input', handleSearchInput);
    DOM.searchClear.addEventListener('click', clearSearch);
    
    // Modal events
    DOM.btnSettings.addEventListener('click', openModal);
    DOM.btnCloseModal.addEventListener('click', closeModal);
    DOM.btnCancelSettings.addEventListener('click', closeModal);
    DOM.btnResetFeed.addEventListener('click', resetFeedUrl);
    DOM.btnSaveSettings.addEventListener('click', saveFeedSettings);
    
    // Close modal on escape or clicking overlay
    DOM.settingsModal.addEventListener('click', (e) => {
        if (e.target === DOM.settingsModal) closeModal();
    });
    
    // Initial fetch
    fetchNotes(false);
});

// Fetch Release Notes from Flask API
async function fetchNotes(forceRefresh = false) {
    showLoading();
    
    let url = '/api/notes';
    const params = new URLSearchParams();
    
    if (state.feedUrl) {
        params.append('url', state.feedUrl);
    }
    if (forceRefresh) {
        params.append('refresh', 'true');
    }
    
    const queryString = params.toString();
    if (queryString) {
        url += `?${queryString}`;
    }
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        
        // Update State
        state.releaseNotes = data.entries || [];
        state.isFallbackActive = data.fallback_used || false;
        
        // Update Status indicator
        let actualSource = data.fetched_url || 'Default feed';
        DOM.statusText.textContent = cleanUrlDisplay(actualSource);
        DOM.footerSourceLink.href = actualSource;
        DOM.footerSourceLink.textContent = actualSource;
        
        if (state.isFallbackActive) {
            DOM.statusDot.className = 'status-dot amber';
            DOM.statusDot.title = 'Default feed (docs.cloud.google.com) failed. Using fallback feed.';
            DOM.fallbackAlert.style.display = 'flex';
        } else {
            DOM.statusDot.className = 'status-dot green';
            DOM.statusDot.title = 'Feed connected successfully.';
            DOM.fallbackAlert.style.display = 'none';
        }
        
        // Process data
        flattenItems();
        calculateMetrics(data.timestamp, data.cached);
        generateCategoryPills();
        renderTimeline();
        
        showContent();
        
        if (forceRefresh) {
            showToast('Feed refreshed successfully!', 'success');
        }
    } catch (err) {
        console.error(err);
        showError(err.message);
    }
}

// Helper to display url nicely
function cleanUrlDisplay(urlStr) {
    try {
        const urlObj = new URL(urlStr);
        return urlObj.hostname;
    } catch (e) {
        return urlStr;
    }
}

// Flatten nested entries for searching/filtering
function flattenItems() {
    state.flatItems = [];
    state.releaseNotes.forEach(entry => {
        entry.items.forEach((item, index) => {
            state.flatItems.push({
                id: `${entry.id || entry.date}-${index}`,
                date: entry.date,
                updated: entry.updated,
                category: item.category,
                content: item.content
            });
        });
    });
}

// Calculate and render dashboard stats
function calculateMetrics(timestamp, isCached) {
    // Total dates (releases)
    DOM.statReleases.textContent = state.releaseNotes.length;
    
    // Total features vs issues
    let features = 0;
    let issues = 0;
    
    state.flatItems.forEach(item => {
        const cat = item.category.toLowerCase();
        if (cat.includes('feature') || cat === 'ga' || cat === 'change' || cat === 'changed') {
            features++;
        } else if (cat.includes('issue') || cat.includes('fix') || cat.includes('deprecation') || cat.includes('deprecated') || cat === 'breaking') {
            issues++;
        }
    });
    
    DOM.statFeatures.textContent = features;
    DOM.statIssues.textContent = issues;
    
    // Sync time
    const syncDate = timestamp ? new Date(timestamp * 1000) : new Date();
    DOM.statSync.textContent = syncDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (isCached ? ' (cached)' : '');
}

// Build category filter buttons dynamically
function generateCategoryPills() {
    // Collect all unique categories
    const categories = new Set();
    state.flatItems.forEach(item => {
        if (item.category) categories.add(item.category);
    });
    
    // Reset category pills element
    DOM.categoryPills.innerHTML = '';
    
    // Add "All" pill
    const allBtn = document.createElement('button');
    allBtn.className = `pill-btn ${state.activeCategory === 'ALL' ? 'active' : ''}`;
    allBtn.setAttribute('data-category', 'ALL');
    allBtn.textContent = 'All Updates';
    allBtn.onclick = () => filterCategory('ALL');
    DOM.categoryPills.appendChild(allBtn);
    
    // Add dynamic pills sorted alphabetically
    Array.from(categories).sort().forEach(cat => {
        // Count how many items in this category
        const count = state.flatItems.filter(item => item.category === cat).length;
        
        const btn = document.createElement('button');
        btn.className = `pill-btn ${state.activeCategory === cat ? 'active' : ''}`;
        btn.setAttribute('data-category', cat);
        btn.innerHTML = `${cat} <span style="opacity: 0.6; font-size: 0.7rem; margin-left: 2px;">(${count})</span>`;
        btn.onclick = () => filterCategory(cat);
        DOM.categoryPills.appendChild(btn);
    });
}

// Handle Category Pill Selection
function filterCategory(category) {
    state.activeCategory = category;
    
    // Update active class on DOM pills
    const pills = DOM.categoryPills.querySelectorAll('.pill-btn');
    pills.forEach(pill => {
        if (pill.getAttribute('data-category') === category) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });
    
    renderTimeline();
}

// Handle Search Keydown/Input
function handleSearchInput(e) {
    state.searchQuery = e.target.value.toLowerCase().trim();
    if (state.searchQuery.length > 0) {
        DOM.searchClear.style.display = 'block';
    } else {
        DOM.searchClear.style.display = 'none';
    }
    renderTimeline();
}

// Clear Search Input
function clearSearch() {
    DOM.searchInput.value = '';
    state.searchQuery = '';
    DOM.searchClear.style.display = 'none';
    renderTimeline();
}

// Filter and render timeline items
function renderTimeline() {
    // Clear viewport
    DOM.notesTimeline.innerHTML = '';
    
    // Apply Filters
    const filteredItems = state.flatItems.filter(item => {
        const matchesCategory = state.activeCategory === 'ALL' || item.category === state.activeCategory;
        const matchesSearch = !state.searchQuery || 
                              item.category.toLowerCase().includes(state.searchQuery) ||
                              item.date.toLowerCase().includes(state.searchQuery) ||
                              item.content.toLowerCase().includes(state.searchQuery);
        return matchesCategory && matchesSearch;
    });
    
    if (filteredItems.length === 0) {
        DOM.notesTimeline.classList.add('hidden');
        DOM.emptyState.classList.remove('hidden');
        return;
    }
    
    DOM.emptyState.classList.add('hidden');
    DOM.notesTimeline.classList.remove('hidden');
    
    // Group filtered items back by date
    const grouped = {};
    filteredItems.forEach(item => {
        if (!grouped[item.date]) {
            grouped[item.date] = [];
        }
        grouped[item.date].push(item);
    });
    
    // Render timeline
    Object.keys(grouped).forEach(date => {
        const items = grouped[date];
        
        // Date Header Group
        const dateGroup = document.createElement('div');
        dateGroup.className = 'date-group';
        
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        
        const dateTitle = document.createElement('h2');
        dateTitle.textContent = date;
        
        const dateLine = document.createElement('div');
        dateLine.className = 'date-line';
        
        dateHeader.appendChild(dateTitle);
        dateHeader.appendChild(dateLine);
        dateGroup.appendChild(dateHeader);
        
        // Cards for this date
        items.forEach(item => {
            const card = document.createElement('div');
            const conf = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG['Update'];
            card.className = `update-card ${conf.cardClass}`;
            
            // Header
            const cardHeader = document.createElement('div');
            cardHeader.className = 'card-header';
            
            const categoryTag = document.createElement('span');
            categoryTag.className = `category-tag ${conf.class}`;
            categoryTag.innerHTML = `<i class="fa-solid ${conf.icon}" style="margin-right: 6px;"></i> ${item.category}`;
            
            const cardActions = document.createElement('div');
            cardActions.className = 'card-actions';
            
            const btnCopy = document.createElement('button');
            btnCopy.className = 'card-icon-btn';
            btnCopy.title = 'Copy Share Link';
            btnCopy.innerHTML = '<i class="fa-regular fa-copy"></i>';
            btnCopy.onclick = () => copyShareLink(item);
            
            const btnTweet = document.createElement('button');
            btnTweet.className = 'card-icon-btn';
            btnTweet.title = 'Tweet this Update';
            btnTweet.innerHTML = '<i class="fa-brands fa-x-twitter"></i>';
            btnTweet.onclick = () => tweetUpdate(item);
            
            cardActions.appendChild(btnCopy);
            cardActions.appendChild(btnTweet);
            cardHeader.appendChild(categoryTag);
            cardHeader.appendChild(cardActions);
            card.appendChild(cardHeader);
            
            // Content Body
            const cardBody = document.createElement('div');
            cardBody.className = 'card-body';
            cardBody.innerHTML = item.content;
            card.appendChild(cardBody);
            
            dateGroup.appendChild(card);
        });
        
        DOM.notesTimeline.appendChild(dateGroup);
    });
}

// Copy sharing link to clipboard
function copyShareLink(item) {
    const shareText = `BigQuery Release Note - ${item.date} [${item.category}]:\n\n${stripHtml(item.content)}\n\nRead more at BigQuery Pulse.`;
    navigator.clipboard.writeText(shareText).then(() => {
        showToast('Update details copied to clipboard!', 'success');
    }).catch(err => {
        showToast('Failed to copy text', 'info');
    });
}

// Tweet update details
function tweetUpdate(item) {
    const headerText = `BigQuery Update [${item.date}] (${item.category}):\n`;
    const footerText = `\n\n#GoogleCloud #BigQuery`;
    const rawContent = stripHtml(item.content).replace(/\s+/g, ' ').trim();
    
    // Twitter character limit is 280 characters.
    // Let's compute remaining characters for content.
    const url = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml";
    const urlText = `\nSource: ${url}`;
    const fixedLength = headerText.length + footerText.length + urlText.length;
    const maxContentLength = 280 - fixedLength;
    
    let content = rawContent;
    if (content.length > maxContentLength) {
        content = content.substring(0, maxContentLength - 3) + "...";
    }
    
    const tweetText = `${headerText}"${content}"${urlText}${footerText}`;
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
    window.open(tweetUrl, '_blank');
}

// Helper to strip html for sharing
function stripHtml(html) {
    let tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
}

// UI State Toggles
function showLoading() {
    DOM.loadingState.classList.remove('hidden');
    DOM.errorState.classList.add('hidden');
    DOM.notesTimeline.classList.add('hidden');
    DOM.emptyState.classList.add('hidden');
    DOM.btnRefresh.classList.add('disabled');
    DOM.btnRefresh.querySelector('i').classList.add('fa-spin');
}

function showContent() {
    DOM.loadingState.classList.add('hidden');
    DOM.errorState.classList.add('hidden');
    DOM.btnRefresh.classList.remove('disabled');
    DOM.btnRefresh.querySelector('i').classList.remove('fa-spin');
}

function showError(msg) {
    DOM.loadingState.classList.add('hidden');
    DOM.notesTimeline.classList.add('hidden');
    DOM.emptyState.classList.add('hidden');
    DOM.errorState.classList.remove('hidden');
    DOM.errorMessage.textContent = msg;
    DOM.btnRefresh.classList.remove('disabled');
    DOM.btnRefresh.querySelector('i').classList.remove('fa-spin');
    showToast('Failed to sync release notes.', 'info');
}

// Settings Modal Operations
function openModal() {
    DOM.settingsModal.classList.remove('hidden');
    DOM.feedUrlInput.value = state.feedUrl;
    DOM.feedUrlInput.focus();
}

function closeModal() {
    DOM.settingsModal.classList.add('hidden');
}

function resetFeedUrl() {
    DOM.feedUrlInput.value = '';
    showToast('Feed URL reset to default.', 'info');
}

function saveFeedSettings() {
    const inputUrl = DOM.feedUrlInput.value.trim();
    
    if (inputUrl) {
        try {
            new URL(inputUrl); // basic validation
        } catch (e) {
            showToast('Please enter a valid URL (including http/https).', 'info');
            return;
        }
        state.feedUrl = inputUrl;
        localStorage.setItem('bigquery_feed_url', inputUrl);
    } else {
        state.feedUrl = '';
        localStorage.removeItem('bigquery_feed_url');
    }
    
    closeModal();
    showToast('Settings saved. Reloading feed...', 'success');
    fetchNotes(false);
}

// Toast Notifications
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    
    DOM.toastContainer.appendChild(toast);
    
    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.4s ease';
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 3000);
}
