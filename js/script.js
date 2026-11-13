// DOM Content Loaded Event
document.addEventListener('DOMContentLoaded', function() {
    // Alert Message System
    window.showAlert = function(message, type = 'info') {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type}`;
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        const closeButton = document.createElement('button');
        closeButton.className = 'alert-close';
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close notification');
        closeButton.textContent = '×';
        alertDiv.append(messageSpan, closeButton);
        
        // Add styles if not already present
        if (!document.querySelector('.alert-styles')) {
            const style = document.createElement('style');
            style.className = 'alert-styles';
            style.textContent = `
                .alert {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 15px 20px;
                    border-radius: 8px;
                    color: white;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    min-width: 300px;
                    max-width: 400px;
                    z-index: 9999;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    animation: slideIn 0.3s ease;
                }
                .alert-info { background-color: #17a2b8; }
                .alert-success { background-color: #28a745; }
                .alert-warning { background-color: #ffc107; color: #333; }
                .alert-error { background-color: #dc3545; }
                .alert-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 20px;
                    cursor: pointer;
                    margin-left: 15px;
                }
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(alertDiv);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => alertDiv.remove(), 300);
            }
        }, 5000);
        
        // Close button functionality
        alertDiv.querySelector('.alert-close').addEventListener('click', () => {
            alertDiv.remove();
        });
    };
    
    // Add slideOut animation for alerts
    const slideOutStyle = document.createElement('style');
    slideOutStyle.textContent = `
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(slideOutStyle);

    initPage();
    initSessionAwareHeader();
});

// Initialize page-specific functionality
function initPage() {
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html';
    
    switch(page) {
        case 'index.html':
            initLoginPage();
            break;
        case 'dashboard.html':
            initDashboardPage();
            break;
        case 'reader.html':
            initReaderPage();
            break;
        case 'character.html':
            initCharacterPage();
            break;
        case 'subscribe.html':
            initSubscribePage();
            break;
        case 'shop.html':
            initShopPage();
            break;
    }
}

const authenticatedPages = new Set([
    'dashboard.html',
    'reader.html',
    'character.html',
    'shop.html',
    'subscribe.html',
    'angular-reviews.html',
    'react-recommendations.html'
]);
let csrfToken = '';

async function readAuthResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        await response.text();
        throw new Error('The authentication API did not return JSON. Run "npm start" and open http://localhost:3000 instead of opening the HTML file or using a static preview.');
    }
    return response.json();
}

async function loadAuthState() {
    const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
    });
    const result = await readAuthResponse(response);
    if (!response.ok || typeof result.csrfToken !== 'string') {
        throw new Error(result.error || 'Unable to verify your account session.');
    }
    csrfToken = result.csrfToken;
    return result;
}

async function submitAuthRequest(endpoint, payload) {
    const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(payload)
    });
    const result = await readAuthResponse(response);
    if (!response.ok) {
        throw new Error(result.error || 'Authentication request failed.');
    }
    csrfToken = result.csrfToken || csrfToken;
    return result;
}

function getPostLoginPath() {
    const requestedPath = new URLSearchParams(window.location.search).get('returnTo');
    const page = requestedPath ? requestedPath.replace(/^\/+/, '') : '';
    return authenticatedPages.has(page) ? `/${page}` : '/dashboard.html';
}

// Login and signup page functionality
function initLoginPage() {
    const loginForm = document.getElementById('loginForm');
    const signupLink = document.getElementById('signupLink');
    if (!loginForm || !signupLink) return;

    const displayNameGroup = document.getElementById('displayNameGroup');
    const displayNameInput = document.getElementById('displayName');
    const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const formTitle = document.getElementById('authTitle');
    const submitButton = loginForm.querySelector('.btn-login');
    const authPrompt = document.getElementById('authPrompt');
    const forgotLink = document.querySelector('.forgot-link');
    let isSignup = false;
    let authStateRequest;

    const updateFormMode = () => {
        displayNameGroup.hidden = !isSignup;
        displayNameInput.required = isSignup;
        displayNameInput.disabled = !isSignup;
        confirmPasswordGroup.hidden = !isSignup;
        confirmPasswordInput.required = isSignup;
        confirmPasswordInput.disabled = !isSignup;
        if (!isSignup) {
            displayNameInput.value = '';
            confirmPasswordInput.value = '';
        }
        passwordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
        passwordInput.minLength = isSignup ? 8 : 0;
        formTitle.textContent = isSignup ? 'Create Your Account' : 'Welcome Back';
        submitButton.textContent = isSignup ? 'Create Account' : 'Login';
        authPrompt.firstChild.textContent = isSignup
            ? 'Already have an account? '
            : "Don't have an account? ";
        signupLink.textContent = isSignup ? 'Log In' : 'Sign Up';
    };

    authStateRequest = loadAuthState().then(state => {
        if (state.user) window.location.replace(getPostLoginPath());
        return state;
    });
    authStateRequest.catch(error => {
        window.showAlert(error.message || 'Unable to connect to the authentication server.', 'error');
    });

    loginForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        if (isSignup && passwordInput.value !== confirmPasswordInput.value) {
            window.showAlert('Your passwords do not match.', 'error');
            confirmPasswordInput.focus();
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = isSignup ? 'Creating account...' : 'Signing in...';
        try {
            await authStateRequest;
            const payload = {
                email: emailInput.value.trim(),
                password: passwordInput.value
            };
            const endpoint = isSignup ? '/api/auth/register' : '/api/auth/login';
            if (isSignup) payload.displayName = displayNameInput.value.trim();
            await submitAuthRequest(endpoint, payload);
            window.location.assign(getPostLoginPath());
        } catch (error) {
            window.showAlert(error.message || 'Unable to complete your request. Please try again.', 'error');
            submitButton.textContent = isSignup ? 'Create Account' : 'Login';
        } finally {
            submitButton.disabled = false;
        }
    });

    signupLink.addEventListener('click', function(event) {
        event.preventDefault();
        isSignup = !isSignup;
        updateFormMode();
    });

    if (forgotLink) {
        forgotLink.addEventListener('click', function(event) {
            event.preventDefault();
            window.showAlert('Password reset is not available yet. Please contact the site administrator.', 'info');
        });
    }

    document.querySelectorAll('.social-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const platform = this.classList.contains('google') ? 'Google' : 
                            this.classList.contains('facebook') ? 'Facebook' : 'Twitter';
            window.showAlert(`${platform} sign-in is not configured yet.`, 'info');
        });
    });
}

function initSessionAwareHeader() {
    const userName = document.querySelector('[data-user-name]');
    const logoutButton = document.querySelector('[data-logout]');
    if (!userName || !logoutButton) return;

    loadAuthState().then(state => {
        if (!state.user) {
            const returnTo = encodeURIComponent(window.location.pathname);
            window.location.replace(`/index.html?returnTo=${returnTo}`);
            return;
        }
        userName.textContent = `Welcome, ${state.user.displayName}!`;
    }).catch(error => {
        window.showAlert(error.message || 'Unable to verify your account session.', 'error');
    });

    logoutButton.addEventListener('click', async () => {
        logoutButton.disabled = true;
        try {
            if (!csrfToken) await loadAuthState();
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRF-Token': csrfToken }
            });
            if (!response.ok) {
                const result = await readAuthResponse(response);
                throw new Error(result.error || 'Unable to sign out.');
            }
            window.location.replace('/index.html');
        } catch (error) {
            window.showAlert(error.message || 'Unable to sign out. Please try again.', 'error');
            logoutButton.disabled = false;
        }
    });
}

// Dashboard Page Functionality
function initDashboardPage() {
    // Subscribe button
    const subscribeBtn = document.getElementById('subscribeBtn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', function() {
            window.location.href = 'subscribe.html';
        });
    }
    
    // Book cards with locked content
    document.querySelectorAll('.btn-read.locked').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            showSubscribeAlert();
        });
    });
    
    // Search functionality
    const searchInput = document.querySelector('.search-bar input');
    const searchButton = document.querySelector('.search-bar button');
    
    if (searchButton) {
        searchButton.addEventListener('click', function() {
            if (searchInput.value.trim()) {
                showAlert(`Searching for: "${searchInput.value}"`, 'info');
            } else {
                showAlert('Please enter a search term', 'warning');
            }
        });
        
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchButton.click();
            }
        });
    }
    
    // Category tags
    document.querySelectorAll('.category-tag').forEach(tag => {
        tag.addEventListener('click', function() {
            const category = this.textContent;
            showAlert(`Filtering by category: ${category}`, 'info');
        });
    });
}

// Reader Page Functionality
function initReaderPage() {
    // Reading mode toggle
    const readSelfBtn = document.getElementById('readSelfBtn');
    const autoReadBtn = document.getElementById('autoReadBtn');
    const bookContent = document.getElementById('bookContent');
    const autoReadPlayer = document.getElementById('autoReadPlayer');
    
    if (readSelfBtn && autoReadBtn) {
        readSelfBtn.addEventListener('click', function() {
            readSelfBtn.classList.add('active');
            autoReadBtn.classList.remove('active');
            bookContent.style.display = 'block';
            autoReadPlayer.style.display = 'none';
            showAlert('Reading mode: Read Yourself', 'info');
        });
        
        autoReadBtn.addEventListener('click', function() {
            autoReadBtn.classList.add('active');
            readSelfBtn.classList.remove('active');
            bookContent.style.display = 'none';
            autoReadPlayer.style.display = 'block';
            showAlert('Reading mode: Auto-Read. Video is playing in background.', 'info');
        });
    }
    
    // Font size controls
    const fontIncrease = document.getElementById('fontIncrease');
    const fontDecrease = document.getElementById('fontDecrease');
    
    if (fontIncrease && fontDecrease) {
        let fontSize = 16;
        
        fontIncrease.addEventListener('click', function() {
            if (fontSize < 24) {
                fontSize += 2;
                bookContent.style.fontSize = fontSize + 'px';
                showAlert(`Font size increased to ${fontSize}px`, 'info');
            } else {
                showAlert('Maximum font size reached', 'warning');
            }
        });
        
        fontDecrease.addEventListener('click', function() {
            if (fontSize > 12) {
                fontSize -= 2;
                bookContent.style.fontSize = fontSize + 'px';
                showAlert(`Font size decreased to ${fontSize}px`, 'info');
            } else {
                showAlert('Minimum font size reached', 'warning');
            }
        });
    }
    
    // Dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', function() {
            bookContent.classList.toggle('dark-mode');
            const isDark = bookContent.classList.contains('dark-mode');
            darkModeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            showAlert(isDark ? 'Dark mode enabled' : 'Dark mode disabled', 'info');
        });
    }
    
    // Bookmark functionality
    const bookmarkBtn = document.getElementById('bookmarkBtn');
    if (bookmarkBtn) {
        let bookmarked = false;
        bookmarkBtn.addEventListener('click', function() {
            bookmarked = !bookmarked;
            bookmarkBtn.innerHTML = bookmarked ? 
                '<i class="fas fa-bookmark"></i>' : 
                '<i class="far fa-bookmark"></i>';
            showAlert(bookmarked ? 'Page bookmarked' : 'Bookmark removed', 'info');
        });
    }
    
    // Auto-read video controls
    const playPauseBtn = document.getElementById('playPauseBtn');
    const stopAutoRead = document.getElementById('stopAutoRead');
    
    if (playPauseBtn) {
        let playing = true;
        playPauseBtn.addEventListener('click', function() {
            playing = !playing;
            playPauseBtn.innerHTML = playing ? 
                '<i class="fas fa-pause"></i>' : 
                '<i class="fas fa-play"></i>';
            showAlert(playing ? 'Video resumed' : 'Video paused', 'info');
        });
    }
    
    if (stopAutoRead) {
        stopAutoRead.addEventListener('click', function() {
            showAlert('Auto-read stopped. Switching to manual mode.', 'info');
            if (readSelfBtn) readSelfBtn.click();
        });
    }
    
    // Chapter navigation
    document.querySelectorAll('.btn-chapter').forEach(btn => {
        btn.addEventListener('click', function() {
            const isNext = this.classList.contains('next-chapter');
            showAlert(isNext ? 'Loading next chapter...' : 'Loading previous chapter...', 'info');
            // In real implementation, this would load the actual chapter
        });
    });
    
    // Character tags
    document.querySelectorAll('.character-tag').forEach(tag => {
        tag.addEventListener('click', function() {
            const character = this.textContent;
            openCharacter(character.toLowerCase());
        });
    });
}

// Character Page Functionality
function initCharacterPage() {
    // Video controls
    const videoPlayPause = document.getElementById('videoPlayPause');
    if (videoPlayPause) {
        let playing = false;
        videoPlayPause.addEventListener('click', function() {
            playing = !playing;
            videoPlayPause.innerHTML = playing ? 
                '<i class="fas fa-pause"></i>' : 
                '<i class="fas fa-play"></i>';
            showAlert(playing ? 'Video playing' : 'Video paused', 'info');
        });
    }
    
    // Related characters
    document.querySelectorAll('.related-character').forEach(char => {
        char.addEventListener('click', function() {
            const character = this.querySelector('h5').textContent;
            changeCharacter(character.toLowerCase());
        });
    });
    
    // Load character data from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const character = urlParams.get('character') || 'rama';
    loadCharacterData(character);
}

// Subscribe Page Functionality
function initSubscribePage() {
    // Payment method toggle
    document.querySelectorAll('input[name="payment"]').forEach(radio => {
        radio.addEventListener('change', function() {
            document.querySelectorAll('.method-option').forEach(option => {
                option.classList.remove('active');
            });
            this.parentElement.classList.add('active');
            
            // Show/hide card details based on selection
            const cardDetails = document.getElementById('cardDetails');
            if (cardDetails) {
                cardDetails.style.display = this.value === 'card' ? 'block' : 'none';
            }
        });
    });
    
    // Subscription plan selection
    document.querySelectorAll('.btn-subscribe-plan').forEach(btn => {
        btn.addEventListener('click', function() {
            const plan = this.getAttribute('data-plan');
            const planName = plan === 'monthly' ? 'Monthly Plan' : 
                            plan === 'yearly' ? 'Yearly Plan' : 'Family Plan';
            showAlert(`Selected ${planName}. Please proceed to payment.`, 'info');
            
            // Scroll to payment section
            document.querySelector('.payment-section').scrollIntoView({ behavior: 'smooth' });
        });
    });
    
    // Complete payment button
    const completePayment = document.getElementById('completePayment');
    if (completePayment) {
        completePayment.addEventListener('click', function() {
            // Validate form
            const cardNumber = document.getElementById('cardNumber');
            const expiryDate = document.getElementById('expiryDate');
            const cvv = document.getElementById('cvv');
            const cardName = document.getElementById('cardName');
            
            if (!cardNumber || cardNumber.value.trim() === '') {
                showAlert('Please enter card number', 'error');
                return;
            }
            
            if (!expiryDate || expiryDate.value.trim() === '') {
                showAlert('Please enter expiry date', 'error');
                return;
            }
            
            if (!cvv || cvv.value.trim() === '') {
                showAlert('Please enter CVV', 'error');
                return;
            }
            
            if (!cardName || cardName.value.trim() === '') {
                showAlert('Please enter name on card', 'error');
                return;
            }
            
            // Simulate payment processing
            showAlert('Processing payment...', 'info');
            
            setTimeout(() => {
                showAlert('Payment successful! Your subscription is now active.', 'success');
                
                // Redirect to dashboard after successful payment
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 2000);
            }, 2000);
        });
    }
    
    // Format card number input
    const cardNumberInput = document.getElementById('cardNumber');
    if (cardNumberInput) {
        cardNumberInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
            let formatted = '';
            
            for (let i = 0; i < value.length; i++) {
                if (i > 0 && i % 4 === 0) formatted += ' ';
                formatted += value[i];
            }
            
            e.target.value = formatted.substring(0, 19);
        });
    }
    
    // Format expiry date input
    const expiryInput = document.getElementById('expiryDate');
    if (expiryInput) {
        expiryInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
            
            if (value.length >= 2) {
                e.target.value = value.substring(0, 2) + '/' + value.substring(2, 4);
            } else {
                e.target.value = value;
            }
        });
    }
}

// Shop Page Functionality
function initShopPage() {
    // Cart toggle
    const cartBtn = document.getElementById('cartBtn');
    const cartSidebar = document.getElementById('cartSidebar');
    const closeCart = document.getElementById('closeCart');
    
    if (cartBtn && cartSidebar) {
        cartBtn.addEventListener('click', function() {
            cartSidebar.classList.add('open');
        });
    }
    
    if (closeCart && cartSidebar) {
        closeCart.addEventListener('click', function() {
            cartSidebar.classList.remove('open');
        });
    }
    
    // Add to cart buttons
    document.querySelectorAll('.btn-add-to-cart').forEach(btn => {
        btn.addEventListener('click', function() {
            const product = this.getAttribute('data-product');
            const productName = getProductName(product);
            showAlert(`"${productName}" added to cart`, 'success');
            
            // Update cart count
            const cartCount = document.querySelector('.cart-count');
            if (cartCount) {
                let count = parseInt(cartCount.textContent);
                cartCount.textContent = count + 1;
            }
        });
    });
    
    // Buy now buttons
    document.querySelectorAll('.btn-buy-now').forEach(btn => {
        btn.addEventListener('click', function() {
            const product = this.getAttribute('data-product');
            const productName = getProductName(product);
            showAlert(`Proceeding to checkout with "${productName}"`, 'info');
            
            // Open cart sidebar
            if (cartSidebar) cartSidebar.classList.add('open');
        });
    });
    
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active class from all filter buttons
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.remove('active');
            });
            
            // Add active class to clicked button
            this.classList.add('active');
            
            const filter = this.textContent;
            showAlert(`Filtering by: ${filter}`, 'info');
        });
    });
    
    // Sort dropdown
    const sortSelect = document.getElementById('sortBy');
    if (sortSelect) {
        sortSelect.addEventListener('change', function() {
            const sortBy = this.options[this.selectedIndex].text;
            showAlert(`Sorted by: ${sortBy}`, 'info');
        });
    }
    
    // Quantity buttons in cart
    document.querySelectorAll('.qty-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const quantitySpan = this.parentElement.querySelector('span');
            let quantity = parseInt(quantitySpan.textContent);
            
            if (this.textContent === '-') {
                if (quantity > 1) {
                    quantitySpan.textContent = quantity - 1;
                    showAlert('Quantity decreased', 'info');
                }
            } else {
                quantitySpan.textContent = quantity + 1;
                showAlert('Quantity increased', 'info');
            }
            
            // Update cart total (simplified)
            updateCartTotal();
        });
    });
    
    // Remove item from cart
    document.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', function() {
            const cartItem = this.closest('.cart-item');
            const productName = cartItem.querySelector('h4').textContent;
            cartItem.remove();
            showAlert(`"${productName}" removed from cart`, 'info');
            
            // Update cart count
            const cartCount = document.querySelector('.cart-count');
            if (cartCount) {
                let count = parseInt(cartCount.textContent);
                if (count > 0) {
                    cartCount.textContent = count - 1;
                }
            }
            
            updateCartTotal();
        });
    });
    
    // Checkout button
    const checkoutBtn = document.querySelector('.btn-checkout');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', function() {
            showAlert('Proceeding to checkout...', 'info');
            // In a real app, this would redirect to checkout page
        });
    }
    
    // Subscribe promo button
    const promoSubscribeBtn = document.querySelector('.btn-promo-subscribe');
    if (promoSubscribeBtn) {
        promoSubscribeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showAlert('Redirecting to subscription page...', 'info');
            window.location.href = 'subscribe.html';
        });
    }
}

// Helper Functions
function showSubscribeAlert() {
    showAlert('This content requires a subscription. Redirecting to subscription page...', 'warning');
    setTimeout(() => {
        window.location.href = 'subscribe.html';
    }, 2000);
}

function openCharacter(character) {
    showAlert(`Loading ${character}'s story...`, 'info');
    setTimeout(() => {
        window.location.href = `character.html?character=${character}`;
    }, 1000);
}

function loadCharacterData(character) {
    // Character data (in a real app, this would come from an API)
    const characters = {
        'rama': {
            name: 'राम',
            title: 'Lord Rama, The Ideal Man',
            source: 'Ramayana',
            family: 'Son of Dasharatha and Kaushalya',
            bio: 'Lord Rama is the seventh avatar of the Hindu god Vishnu and the central figure of the Ramayana. He is considered the ideal man (Maryada Purushottam) and exemplifies righteousness, duty, honor, and compassion.',
            stories: [
                'Birth and childhood in Ayodhya',
                'Marriage to Sita by breaking Shiva\'s bow',
                '14-year exile to the forest',
                'Abduction of Sita by Ravana',
                'Building alliance with Sugriva and Hanuman',
                'Battle of Lanka and defeat of Ravana',
                'Return to Ayodhya and coronation'
            ],
            videoTitle: 'The Life of Lord Rama - Complete Story'
        },
        'sita': {
            name: 'सीता',
            title: 'Goddess Sita, The Ideal Wife',
            source: 'Ramayana',
            family: 'Daughter of King Janaka, Wife of Rama',
            bio: 'Sita is the central female character of the Ramayana. She is the consort of Lord Rama and is revered as the ideal wife and woman. She is known for her devotion, virtue, and sacrifice.',
            stories: [
                'Birth from the earth',
                'Swayamvara and marriage to Rama',
                'Exile with Rama to the forest',
                'Abduction by Ravana',
                'Confinement in Ashoka Vatika',
                'Agni Pariksha (trial by fire)',
                'Return to Ayodhya and later exile'
            ],
            videoTitle: 'The Story of Goddess Sita - Symbol of Purity'
        },
        'lakshman': {
            name: 'लक्ष्मण',
            title: 'Lakshmana, The Devoted Brother',
            source: 'Ramayana',
            family: 'Son of Dasharatha and Sumitra, Brother of Rama',
            bio: 'Lakshmana is the younger brother and close companion of Lord Rama. He is known for his unwavering loyalty, courage, and dedication to his elder brother.',
            stories: [
                'Childhood with Rama',
                'Accompanying Rama to the forest',
                'Protecting Sita during exile',
                'Fighting against Ravana\'s army',
                'Being injured by Indrajit',
                'Serving Rama during his reign',
                'Ultimate sacrifice for Rama'
            ],
            videoTitle: 'Lakshmana - The Ultimate Brother'
        },
         'lakshman': {
            name: 'लक्ष्मण',
            title: 'Lakshmana, The Devoted Brother',
            source: 'Ramayana',
            family: 'Son of Dasharatha and Sumitra, Brother of Rama',
            bio: 'Lakshmana is the younger brother and close companion of Lord Rama. He is known for his unwavering loyalty, courage, and dedication to his elder brother.',
            stories: [
                'Childhood with Rama',
                'Accompanying Rama to the forest',
                'Protecting Sita during exile',
                'Fighting against Ravana\'s army',
                'Being injured by Indrajit',
                'Serving Rama during his reign',
                'Ultimate sacrifice for Rama'
            ],
            videoTitle: 'Lakshmana - The Ultimate Brother'
        }

    };
    
    const charData = characters[character] || characters['rama'];
    
    // Update DOM elements
    const characterName = document.getElementById('characterName');
    const characterTitle = document.getElementById('characterTitle');
    const characterSource = document.getElementById('characterSource');
    const characterFamily = document.getElementById('characterFamily');
    const characterBio = document.getElementById('characterBio');
    const characterStories = document.getElementById('characterStories');
    const videoTitle = document.getElementById('videoTitle');
    
    if (characterName) characterName.textContent = charData.name;
    if (characterTitle) characterTitle.textContent = charData.title;
    if (characterSource) characterSource.textContent = charData.source;
    if (characterFamily) characterFamily.textContent = charData.family;
    if (characterBio) characterBio.textContent = charData.bio;
    if (characterStories) {
        characterStories.innerHTML = '';
        charData.stories.forEach(story => {
            const li = document.createElement('li');
            li.textContent = story;
            characterStories.appendChild(li);
        });
    }
    if (videoTitle) videoTitle.textContent = charData.videoTitle;
}

function changeCharacter(character) {
    showAlert(`Loading ${character}'s profile...`, 'info');
    loadCharacterData(character);
}

function getProductName(productId) {
    const products = {
        'ramayana': 'रामायण (हार्डकवर)',
        'mahabharata': 'महाभारत (हार्डकवर)',
        'gitanjali': 'गीतांजलि (हार्डकवर)',
        'vedas': 'वेद संग्रह (4 खंड)'
    };
    return products[productId] || 'Product';
}

function updateCartTotal() {
    // Simplified cart total update
    // In a real app, this would calculate based on actual prices
    const cartItems = document.querySelectorAll('.cart-item');
    if (cartItems.length === 0) {
        const cartCount = document.querySelector('.cart-count');
        if (cartCount) cartCount.textContent = '0';
    }
}

// Export functions for global use
window.showSubscribeAlert = showSubscribeAlert;
window.openCharacter = openCharacter;
window.changeCharacter = changeCharacter;