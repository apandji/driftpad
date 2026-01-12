(function () {
  // Driftpad v2 Prompt System
  // New system that supports categories, locations, and gallery integration
  
  console.log('🎨 Driftpad v2 script loaded!');
  
  // Geohash encoding function for neighborhood variation
  function encodeGeohash(lat, lng, precision = 6) {
    const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    let bits = 0;
    let bit = 0;
    let ch = 0;
    let even = true;
    let geohash = '';
    
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    
    while (geohash.length < precision) {
      if (even) {
        const lngMid = (lngMin + lngMax) / 2;
        if (lng >= lngMid) {
          ch |= (1 << (4 - bit));
          lngMin = lngMid;
        } else {
          lngMax = lngMid;
        }
      } else {
        const latMid = (latMin + latMax) / 2;
        if (lat >= latMid) {
          ch |= (1 << (4 - bit));
          latMin = latMid;
        } else {
          latMax = latMid;
        }
      }
      
      even = !even;
      
      if (bit < 4) {
        bit++;
      } else {
        geohash += base32[ch];
        bit = 0;
        ch = 0;
      }
    }
    
    return geohash;
  }
  
let currentPrompt = null;
let currentLocation = null;
let sessionId = null;
let lastPromptId = null;
let sessionPromptHistory = [];
let categoryHistory = [];
let isAnimating = false;
let currentAnimationInterval = null;
let locationDetectionEnabled = false;
let loadingIndicator = null;
  
  // Button state management
  function setButtonsEnabled(enabled) {
    const newPromptBtn = document.getElementById('new-prompt-btn');
    const clearBtn = document.getElementById('clear');
    
    if (newPromptBtn) {
      newPromptBtn.disabled = !enabled;
      newPromptBtn.style.opacity = enabled ? '1' : '0.5';
    }
    
    if (clearBtn) {
      clearBtn.disabled = !enabled;
      clearBtn.style.opacity = enabled ? '1' : '0.5';
    }
  }
  
  // Stop all current animations
  function stopAllAnimations() {
    if (currentAnimationInterval) {
      clearInterval(currentAnimationInterval);
      currentAnimationInterval = null;
    }
    
    // Stop shape generator animations if available
    if (window.shapeGenerator && window.shapeGenerator.fadeInInterval) {
      clearInterval(window.shapeGenerator.fadeInInterval);
      window.shapeGenerator.fadeInInterval = null;
    }
    
    isAnimating = false;
    setButtonsEnabled(true);
    hideLoadingIndicator();
  }

  // Show zen loading indicator as toast-style card
  function showLoadingIndicator(loadingType = 'prompt') {
    if (loadingIndicator) {
      return; // Already showing
    }

    // Whimsical loading messages
    const messages = {
      'shape': 'A shape is drifting into view...',
      'image': 'A drawing is materializing...',
      'prompt': 'Loading new prompt...'
    };

    const indicator = document.createElement('div');
    indicator.className = 'zen-loading-toast';
    indicator.innerHTML = `
      <div class="zen-loading-content">
        <div class="zen-loading-dots">
          <div class="zen-dot"></div>
          <div class="zen-dot"></div>
          <div class="zen-dot"></div>
        </div>
        <div class="zen-loading-text">${messages[loadingType] || messages.prompt}</div>
      </div>
    `;
    
    document.body.appendChild(indicator);
    loadingIndicator = indicator;
    
    // Fade in
    setTimeout(() => {
      indicator.classList.add('visible');
    }, 10);
  }

  // Hide zen loading indicator
  function hideLoadingIndicator() {
    if (!loadingIndicator) {
      return;
    }

    loadingIndicator.classList.add('fade-out');
    setTimeout(() => {
      if (loadingIndicator && loadingIndicator.parentNode) {
        loadingIndicator.parentNode.removeChild(loadingIndicator);
      }
      loadingIndicator = null;
    }, 300);
  }

  // Show fallback message when gallery loading fails
  function showGalleryTimeoutMessage() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw a simple fallback message
    ctx.fillStyle = '#666';
    ctx.font = '16px Averia Sans Libre, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    ctx.fillText('Gallery image unavailable', centerX, centerY - 20);
    ctx.fillText('Please try again or refresh', centerX, centerY + 20);
    
    // Re-enable buttons
    isAnimating = false;
    setButtonsEnabled(true);
    hideLoadingIndicator();
    
    console.log('Gallery timeout fallback message displayed');
  }

  // Wait for Supabase client to be ready
  async function waitForSupabase(maxWait = 5000) {
    const startTime = Date.now();
    while (typeof window.supabaseClient === 'undefined' || window.supabaseClient === null) {
      if (Date.now() - startTime > maxWait) {
        console.error('❌ Supabase client not available after', maxWait, 'ms');
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('✅ Supabase client is ready');
    return true;
  }

  // Initialize the new prompt system
  async function init() {
    const target = document.querySelector('.prompt');
    const newPromptBtn = document.getElementById('new-prompt-btn');
    
    console.log('Driftpad v2 Prompt System initializing...');
    console.log('DOM elements found:', { target, newPromptBtn });
    console.log('Supabase client status:', typeof window.supabaseClient);
    
    
    if (!target || !newPromptBtn) {
      console.error('Required DOM elements not found for v2 prompt system');
      return;
    }

    // Show loading state to prevent placeholder "text" from showing
    target.textContent = 'Loading...';

    // Wait for Supabase client to be ready
    const supabaseReady = await waitForSupabase();
    if (!supabaseReady) {
      console.warn('⚠️ Supabase not available, will use fallback prompts');
    }

    // Initialize session tracking
    initSession();
    
    // Initialize location detection first
    console.log('📍 About to start location detection...');
    await initLocationDetection();
    console.log('📍 Location detection completed');
    
    // Initialize shape generator for complete_shape prompts
    initShapeGenerator();
    
    // Load initial prompt after location detection is complete
    await loadNewPrompt();
    
    // Set up event listeners
    newPromptBtn.addEventListener('click', () => {
      loadNewPrompt();
    });
  }

  // Initialize session tracking
  function initSession() {
    sessionId = localStorage.getItem('driftpad_session_id');
    if (!sessionId) {
      sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('driftpad_session_id', sessionId);
    }
    
    // Load session prompt history
    const historyKey = `driftpad_prompt_history_${sessionId}`;
    const storedHistory = localStorage.getItem(historyKey);
    if (storedHistory) {
      sessionPromptHistory = JSON.parse(storedHistory);
    }
    
    console.log('Session ID:', sessionId);
    console.log('Prompt history loaded:', sessionPromptHistory.length, 'prompts');
  }

  // Initialize location detection
  async function initLocationDetection() {
    console.log('🔍 Starting location detection...');
    
    // Show loading indicator while colors are being loaded
    showToolbarLoading();
    
    // Set a timeout to ensure colors load even if location detection fails
    const colorLoadingTimeout = setTimeout(() => {
      console.log('⏰ Color loading timeout - falling back to default colors');
      ensureZenColorsFallback();
    }, 5000); // 5 second timeout
    
    // Check for URL override first
    const urlParams = new URLSearchParams(window.location.search);
    const locationOverride = urlParams.get('location');
    
    if (locationOverride) {
      console.log('📍 Location override detected:', locationOverride);
      await loadLocationBySlug(locationOverride);
      clearTimeout(colorLoadingTimeout);
      return;
    }
    
    console.log('🌍 No URL override, checking geolocation...');
    
    // Check if geolocation is available
    if (navigator.geolocation) {
      console.log('✅ Geolocation API available');
      
      // Check if we already have permission
      if (navigator.permissions) {
        try {
          const permission = await navigator.permissions.query({ name: 'geolocation' });
          console.log('📍 Permission state:', permission.state);
          
          if (permission.state === 'granted') {
            console.log('✅ Location permission already granted');
            requestLocationDirectly();
            return;
          } else if (permission.state === 'denied') {
            console.log('❌ Location permission denied - user previously denied');
            showLocationDeniedMessage();
            return;
          } else if (permission.state === 'prompt') {
            console.log('📍 Permission state is "prompt" - will show permission dialog');
          }
        } catch (err) {
          console.log('⚠️ Permission API not supported, proceeding with request');
        }
      }
      
      // Show pre-permission context
      showLocationPermissionContext();
    } else {
      console.log('❌ Geolocation not available in this browser');
      // Fallback to default colors immediately
      setTimeout(() => {
        ensureZenColorsFallback();
      }, 1000);
    }
  }

  // Show friendly location permission context as toast
  function showLocationPermissionContext() {
    console.log('🌍 Showing location permission context...');
    
    // Check if we're on HTTPS or localhost
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname.includes('127.0.0.1');
    
    const toastDiv = document.createElement('div');
    toastDiv.className = 'location-permission-toast';
    toastDiv.innerHTML = `
      <div class="location-toast-content">
        <div class="location-toast-icon">🌍</div>
        <div class="location-toast-text">
          <div class="location-toast-title">Where in the world are you?</div>
          <div class="location-toast-description">Let's paint with your place's colors</div>
          ${!isSecure ? '<div class="location-toast-warning">⚠️ Note: Location requires HTTPS in production</div>' : ''}
        </div>
        <div class="location-toast-buttons">
          <button class="location-allow-btn" onclick="requestLocationPermission()">Yes!</button>
          <button class="location-skip-btn" onclick="skipLocationPermission()">Nah</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(toastDiv);
    
    // Fade in
    setTimeout(() => {
      toastDiv.classList.add('visible');
    }, 10);
  }

  // Request location permission after user clicks "Allow"
  function requestLocationPermission() {
    console.log('🌍 User clicked Allow Location');
    
    // Hide the toast
    const toastDiv = document.querySelector('.location-permission-toast');
    if (toastDiv) {
      toastDiv.classList.add('fade-out');
      setTimeout(() => toastDiv.remove(), 300);
    }
    
    // Add a small delay to ensure toast is hidden before requesting location
    setTimeout(() => {
      console.log('🌍 Requesting location after user permission...');
      requestLocationDirectly();
    }, 100);
  }

  // Skip location permission
  function skipLocationPermission() {
    console.log('🌍 User skipped location permission');
    
    // Hide the toast
    const toastDiv = document.querySelector('.location-permission-toast');
    if (toastDiv) {
      toastDiv.classList.add('fade-out');
      setTimeout(() => toastDiv.remove(), 300);
    }
    
    // Show generic message
    showLocationDeniedMessage();
  }

  // Add subtle coordinate color hint to logo
  function addCoordinateColorHint(accentColor) {
    console.log('🎨 Adding coordinate color to logo:', accentColor);
    
    // Convert HSL to RGB for CSS
    const rgbColor = hslToRgbString(accentColor);
    console.log('🎨 RGB color for logo:', rgbColor);
    
    // Simply change the logo color
    const logo = document.getElementById('logo');
    if (logo) {
      logo.style.color = rgbColor;
      console.log('🎨 Logo color changed to:', rgbColor);
    } else {
      console.log('❌ Logo element not found!');
    }
  }

  // Convert HSL string to RGB string for CSS
  function hslToRgbString(hslString) {
    const match = hslString.match(/hsl\(([^,]+),\s*([^%]+)%,\s*([^%]+)%\)/);
    if (!match) return '#000000';
    
    const h = parseFloat(match[1]);
    const s = parseFloat(match[2]);
    const l = parseFloat(match[3]);
    
    const rgb = hslToRgb(h, s, l);
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  // Apply location-based theming to the interface
  function applyLocationTheming(colors) {
    console.log('🎨 Applying location theming:', colors);
    
    // Set CSS custom properties for location colors
    document.documentElement.style.setProperty('--location-primary', colors.primary);
    document.documentElement.style.setProperty('--location-secondary', colors.secondary);
    document.documentElement.style.setProperty('--location-accent', colors.accent);
    document.documentElement.style.setProperty('--location-background', colors.background);
    document.documentElement.style.setProperty('--location-text', colors.text);
    
    // Add location-themed class to body
    document.body.classList.add('location-themed');
    
    console.log('🎨 Location theming applied');
  }

  // Make functions globally accessible
  window.requestLocationPermission = requestLocationPermission;
  window.skipLocationPermission = skipLocationPermission;

  // Simple Toolbar Functionality
  function initSimpleToolbar() {
    console.log('🎨 Initializing simple toolbar');
    console.log('🎨 Watercolor brush available:', !!window.watercolorBrush);
    console.log('🎨 Sketch loaded:', !!window.sketchLoaded);
    
    // Check if brush is available
    if (!window.watercolorBrush) {
      console.log('⏳ Watercolor brush not ready, retrying in 1 second...');
      setTimeout(() => {
        initSimpleToolbar();
      }, 1000);
      return;
    }
    
    // Clean up existing color swatches and create new ones
    const zenColorsContainer = document.getElementById('zen-colors');
    
    if (!zenColorsContainer) {
      console.log('❌ zen-colors container not found!');
      return;
    }
    
    console.log('🎨 Found zen-colors container:', zenColorsContainer);
    
    // Remove all existing color swatches
    const existingSwatches = document.querySelectorAll('.zen-color-swatch');
    existingSwatches.forEach(swatch => swatch.remove());
    console.log('🎨 Removed', existingSwatches.length, 'existing color swatches');
    
    // Create new color swatches
    console.log('🎨 Creating new color swatches');
    // Get colors from brush or use defaults
    const colors = window.watercolorBrush ? window.watercolorBrush.zenColors : ['#000000', '#333333', '#666666', '#999999', '#E6E6E6'];
    
    colors.forEach((color, index) => {
      const swatch = document.createElement('div');
      swatch.className = 'zen-color-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = `Color ${index + 1}`;
      zenColorsContainer.appendChild(swatch);
    });
    
    // Get the new swatches
    const colorSwatches = document.querySelectorAll('.zen-color-swatch');
    console.log('🎨 Created', colorSwatches.length, 'new color swatches');
    
    // Setup color swatch listeners
    colorSwatches.forEach((swatch, index) => {
      console.log('🎨 Setting up listener for color', index);
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🎨 Color', index, 'clicked');
        selectColor(index);
      });
    });
    
    // Setup eraser listener
    const eraserSwatch = document.getElementById('eraser-swatch');
    if (eraserSwatch) {
      console.log('🧹 Setting up eraser listener');
      eraserSwatch.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🧹 Eraser button clicked');
        selectEraser();
      });
    } else {
      console.log('❌ Eraser swatch not found');
    }
    
    console.log('🎨 Simple toolbar initialized');
  }

  // Color selection (turns off eraser)
  function selectColor(colorIndex) {
    console.log('🎨 Selecting color:', colorIndex);
    
    // Check if color swatches exist
    const colorSwatches = document.querySelectorAll('.zen-color-swatch');
    if (colorSwatches.length === 0) {
      console.log('❌ Color swatches not found, skipping color selection');
      return;
    }
    
    // ALWAYS turn off eraser when any color is selected
    const eraserSwatch = document.getElementById('eraser-swatch');
    if (eraserSwatch) {
      eraserSwatch.classList.remove('active');
      console.log('🧹 Eraser visual state turned OFF');
    }
    
    // Update visual state - clear all color selections first
    colorSwatches.forEach(swatch => {
      swatch.classList.remove('active');
    });
    
    // Select the chosen color
    if (colorSwatches[colorIndex]) {
      colorSwatches[colorIndex].classList.add('active');
      console.log('🎨 Color', colorIndex, 'visual state turned ON');
    }
    
    // Update brush to normal drawing mode (turn OFF eraser)
    if (window.watercolorBrush) {
      window.watercolorBrush.currentColorIndex = colorIndex;
      window.watercolorBrush.currentColor = window.watercolorBrush.zenColors[colorIndex];
      if (typeof window.watercolorBrush.setErasingMode === 'function') {
        window.watercolorBrush.setErasingMode(false);
      } else {
        // Fallback: set properties directly
        window.watercolorBrush.isErasing = false;
      }
      console.log('🎨 Eraser mode turned OFF, color', colorIndex, 'selected');
    } else {
      console.log('❌ Watercolor brush not available');
    }
  }

  // Eraser selection (turns off colors, or toggles off if already selected)
  function selectEraser() {
    const eraserSwatch = document.getElementById('eraser-swatch');
    const isCurrentlyActive = eraserSwatch.classList.contains('active');
    
    console.log('🧹 Eraser clicked, currently active:', isCurrentlyActive);
    
    if (isCurrentlyActive) {
      // Turn off eraser - go back to first color
      console.log('🧹 Turning off eraser');
      eraserSwatch.classList.remove('active');
      
      // Try to select first color, but don't fail if colors aren't ready
      const colorSwatches = document.querySelectorAll('.zen-color-swatch');
      if (colorSwatches.length > 0) {
        selectColor(0);
      } else {
        console.log('🧹 Color swatches not ready, just turning off eraser');
        // Just turn off eraser mode without selecting a color
        if (window.watercolorBrush) {
          if (typeof window.watercolorBrush.setErasingMode === 'function') {
            window.watercolorBrush.setErasingMode(false);
          } else {
            window.watercolorBrush.isErasing = false;
          }
        }
      }
    } else {
      // Turn on eraser
      console.log('🧹 Turning on eraser');
      
      // Update visual state - clear all color selections
      document.querySelectorAll('.zen-color-swatch').forEach(swatch => {
        swatch.classList.remove('active');
      });
      eraserSwatch.classList.add('active');
      console.log('🧹 Eraser visual state turned ON, all colors turned OFF');
      
      // Update brush to eraser mode
      if (window.watercolorBrush) {
        if (typeof window.watercolorBrush.setErasingMode === 'function') {
          window.watercolorBrush.setErasingMode(true);
        } else {
          // Fallback: set properties directly
          window.watercolorBrush.isErasing = true;
          console.log('🧹 Erasing mode set via fallback');
        }
      } else {
        console.log('❌ Watercolor brush not available for eraser');
      }
    }
  }

  // Make functions globally accessible
  window.initSimpleToolbar = initSimpleToolbar;
  window.selectColor = selectColor;
  window.selectEraser = selectEraser;

  // Initialize toolbar when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🎨 DOMContentLoaded fired, scheduling initSimpleToolbar');
    setTimeout(() => {
      console.log('🎨 Calling initSimpleToolbar after 2 second delay');
      initSimpleToolbar();
    }, 2000); // Wait longer for other scripts to load
  });
  

  // Request location directly (after user consent)
  function requestLocationDirectly() {
    console.log('🌍 Starting geolocation request...');
    
    // Check if geolocation is available
    if (!navigator.geolocation) {
      console.log('📍 Geolocation not supported by this browser');
      showLocationDeniedMessage();
      return;
    }
    
    // Check if we're on HTTPS (required for geolocation in many browsers)
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && !location.hostname.includes('127.0.0.1')) {
      console.log('⚠️ Geolocation requires HTTPS in production. Current protocol:', location.protocol);
      console.log('💡 For development: Use localhost or enable HTTPS');
      showLocationDeniedMessage();
      return;
    }
    
    console.log('✅ Protocol check passed:', location.protocol, 'on', location.hostname);
    
    console.log('📍 Calling navigator.geolocation.getCurrentPosition...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log('🎯 User location detected:', { latitude, longitude });
        findNearbyLocation(latitude, longitude);
      },
      (error) => {
        console.log('❌ Geolocation error:', error.message, error.code);
        
        // Provide more specific error information
        let errorMessage = 'Location unavailable';
        switch(error.code) {
          case 1:
            errorMessage = 'Location permission denied';
            break;
          case 2:
            errorMessage = 'Location information unavailable';
            break;
          case 3:
            errorMessage = 'Location request timeout';
            break;
          default:
            errorMessage = 'Location error: ' + error.message;
        }
        
        console.log('📍 Geolocation failed:', errorMessage);
        
        // Check if this is a security policy issue
        if (error.code === 2 && error.message === '') {
          console.log('🔒 Possible security policy blocking geolocation');
          console.log('💡 Try: 1) Check browser location settings, 2) Ensure HTTPS, 3) Check browser security policies');
        }
        
        showLocationDeniedMessage();
        clearTimeout(colorLoadingTimeout);
      },
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 600000
      }
    );
  }

  // Show message when location is denied or unavailable
  function showLocationDeniedMessage() {
    console.log('📍 Showing location denied message');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'location-denied-message';
    messageDiv.innerHTML = `
      <div class="location-denied-content">
        <div class="location-denied-icon">🎨</div>
        <div class="location-denied-text">
          <p>No worries! We'll paint with zen colors instead</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(messageDiv);
    
    // Fade in
    setTimeout(() => {
      messageDiv.classList.add('visible');
    }, 10);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      messageDiv.classList.add('fade-out');
      setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
    
    // Ensure zen colors are available as fallback
    ensureZenColorsFallback();
  }
  
  // Ensure zen colors are available when geolocation fails
  function ensureZenColorsFallback() {
    console.log('🎨 Ensuring zen colors fallback is available');
    
    // Wait for watercolor brush to be available
    const checkForBrush = () => {
      if (window.watercolorBrush) {
        console.log('✅ Watercolor brush available, using default zen colors');
        
        // Get default zen colors from brush
        const defaultZenColors = window.watercolorBrush.getZenColors();
        console.log('Default zen colors:', defaultZenColors);
        
        // Update color preview with default zen colors
        setTimeout(() => {
          updateColorPreview(defaultZenColors);
        }, 100);
        
      } else {
        console.log('⏳ Watercolor brush not ready, retrying...');
        setTimeout(checkForBrush, 500);
      }
    };
    
    checkForBrush();
  }
  
  // Show toolbar loading indicator
  function showToolbarLoading() {
    const loadingIndicator = document.getElementById('toolbar-loading');
    if (loadingIndicator) {
      loadingIndicator.classList.add('show');
    }
  }
  
  // Hide toolbar loading indicator
  function hideToolbarLoading() {
    const loadingIndicator = document.getElementById('toolbar-loading');
    if (loadingIndicator) {
      loadingIndicator.classList.remove('show');
      // Also add fade-out class for smoother transition
      loadingIndicator.classList.add('fade-out');
    }
  }
  
  // Show toolbar when colors are loaded
  function showToolbar() {
    const toolbar = document.querySelector('.toolbar');
    if (toolbar) {
      toolbar.classList.add('colors-loaded');
    }
  }
  
  // Check if colors are actually visible in the DOM
  function areColorsVisible() {
    const zenColorsContainer = document.getElementById('zen-colors');
    if (!zenColorsContainer) return false;
    
    const colorElements = zenColorsContainer.querySelectorAll('.zen-color');
    if (colorElements.length === 0) return false;
    
    // Check if at least one color element is actually visible (not just in DOM)
    for (let i = 0; i < colorElements.length; i++) {
      const element = colorElements[i];
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return true;
      }
    }
    
    return false;
  }

  // Load location by slug (for URL override)
  async function loadLocationBySlug(slug) {
    console.log('Loading location by slug:', slug);
    
    if (typeof window.supabaseClient === 'undefined' || window.supabaseClient === null) {
      console.log('⚠️ Supabase not available, using generic prompts');
      return;
    }
    
    try {
      // Fast query - just get the location by slug
      const { data, error } = await window.supabaseClient
        .from('locations')
        .select('id, name, slug, latitude, longitude, radius_meters, is_active')
        .eq('slug', slug)
        .eq('is_active', true)
        .limit(1);
      
      if (error) {
        console.error('❌ Error loading location by slug:', error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return;
      }
      
      if (data && data.length > 0) {
        currentLocation = data[0];
        console.log('Location loaded:', currentLocation.name);
        updateLocationDisplay(currentLocation);
        applyLocationInkColors(currentLocation);
        locationDetectionEnabled = true;
      } else {
        console.log('No location found for slug:', slug);
      }
    } catch (err) {
      console.error('Error loading location:', err);
    }
  }

  // Find nearby location based on coordinates
  async function findNearbyLocation(latitude, longitude) {
    console.log('🔍 Searching for nearby locations...');
    console.log('📍 User coordinates:', { latitude, longitude });
    
    if (typeof window.supabaseClient === 'undefined' || window.supabaseClient === null) {
      console.log('❌ Supabase not available, using generic prompts');
      return;
    }
    
    try {
      console.log('📡 Querying locations from database...');
      const { data, error } = await window.supabaseClient
        .from('locations')
        .select('id, name, slug, latitude, longitude, radius_meters')
        .eq('is_active', true);
      
      if (error) {
        console.error('❌ Error loading locations:', error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return;
      }
      
      console.log('📊 Found', data?.length || 0, 'active locations in database');
      
      if (data && data.length > 0) {
        console.log('🔍 Checking distances to each location...');
        let foundLocation = false;
        
        // Find location within radius
        for (const location of data) {
          const distance = calculateDistance(
            latitude, longitude,
            location.latitude, location.longitude
          );
          
          console.log(`📍 ${location.name}: ${distance.toFixed(0)}m (radius: ${location.radius_meters}m)`);
          
          if (distance <= location.radius_meters) {
            currentLocation = location;
            console.log('🎯 Nearby location found:', currentLocation.name, 'Distance:', distance.toFixed(0), 'm');
            updateLocationDisplay(currentLocation);
            applyLocationInkColors(currentLocation);
            locationDetectionEnabled = true;
            foundLocation = true;
            break;
          }
        }
        
        if (!foundLocation) {
          console.log('📍 No nearby locations found within radius');
          console.log('🎨 Generating coordinate-based colors...');
          
          // Create a virtual location object for coordinate-based colors
          const virtualLocation = {
            name: 'Your Location',
            latitude: latitude,
            longitude: longitude,
            city: 'Unknown',
            state: null
          };
          
          console.log('🎨 Applying coordinate-based colors for your location');
          applyLocationInkColors(virtualLocation);
        }
      } else {
        console.log('📊 No locations found in database');
      }
    } catch (err) {
      console.error('❌ Error finding nearby location:', err);
    }
  }

  // Enhanced color generation system using multiple location attributes
  function generateLocationColors(location) {
    console.log('Generating colors for location:', location.name);
    
    // Location type mapping for thematic colors
    const typeColorMap = {
      'park': { baseHue: 120, saturation: 60, lightness: 50 }, // Green
      'museum': { baseHue: 280, saturation: 40, lightness: 45 }, // Purple
      'downtown': { baseHue: 200, saturation: 50, lightness: 40 }, // Blue
      'garden': { baseHue: 60, saturation: 70, lightness: 55 }, // Yellow
      'forest': { baseHue: 140, saturation: 65, lightness: 35 }, // Dark Green
      'waterfront': { baseHue: 180, saturation: 55, lightness: 50 }, // Cyan
      'urban': { baseHue: 0, saturation: 20, lightness: 30 }, // Gray
      'historic': { baseHue: 30, saturation: 45, lightness: 40 } // Brown
    };
    
    // State-based color themes
    const stateColorMap = {
      'MO': { baseHue: 200, saturation: 50, lightness: 45 }, // Missouri blue
      'IL': { baseHue: 0, saturation: 30, lightness: 40 }, // Illinois red
      'CA': { baseHue: 30, saturation: 60, lightness: 50 }, // California gold
      'NY': { baseHue: 240, saturation: 40, lightness: 35 }, // New York navy
      'TX': { baseHue: 0, saturation: 20, lightness: 25 }, // Texas gray
      'FL': { baseHue: 180, saturation: 50, lightness: 55 }, // Florida aqua
      'WA': { baseHue: 120, saturation: 40, lightness: 30 }, // Washington green
      'CO': { baseHue: 60, saturation: 70, lightness: 60 } // Colorado gold
    };
    
    // City-based color themes
    const cityColorMap = {
      'st. louis': { baseHue: 200, saturation: 45, lightness: 40 }, // Gateway blue
      'chicago': { baseHue: 240, saturation: 35, lightness: 30 }, // Windy city navy
      'new york': { baseHue: 0, saturation: 25, lightness: 20 }, // Big apple gray
      'los angeles': { baseHue: 30, saturation: 55, lightness: 50 }, // LA gold
      'san francisco': { baseHue: 180, saturation: 40, lightness: 45 }, // Fog city blue
      'seattle': { baseHue: 120, saturation: 35, lightness: 25 }, // Emerald city green
      'miami': { baseHue: 180, saturation: 60, lightness: 60 }, // Miami aqua
      'denver': { baseHue: 60, saturation: 65, lightness: 55 } // Mile high gold
    };
    
    // Generate multiple color sources
    let finalHue, finalSaturation, finalLightness;
    
    // 1. Try name-based detection first
    let locationType = 'urban';
    const nameLower = location.name.toLowerCase();
    for (const [type, _] of Object.entries(typeColorMap)) {
      if (nameLower.includes(type)) {
        locationType = type;
        break;
      }
    }
    
    if (locationType !== 'urban') {
      // Use name-based type colors
      const baseColors = typeColorMap[locationType];
      const nameHash = location.name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      const nameHue = nameHash % 360;
      
      finalHue = (baseColors.baseHue + nameHue * 0.3) % 360;
      finalSaturation = Math.min(80, baseColors.saturation + (nameHash % 20));
      finalLightness = Math.max(20, Math.min(80, baseColors.lightness + (nameHash % 15) - 7));
      
      console.log('Using name-based colors for type:', locationType);
    } else {
      // 2. Try city-based colors
      const cityLower = (location.city || '').toLowerCase();
      if (cityColorMap[cityLower]) {
        const cityColors = cityColorMap[cityLower];
        const nameHash = location.name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        
        finalHue = (cityColors.baseHue + (nameHash % 60) - 30) % 360;
        finalSaturation = Math.min(80, cityColors.saturation + (nameHash % 20));
        finalLightness = Math.max(20, Math.min(80, cityColors.lightness + (nameHash % 15) - 7));
        
        console.log('Using city-based colors for:', cityLower);
      } else if (location.state && stateColorMap[location.state]) {
        // 3. Try state-based colors
        const stateColors = stateColorMap[location.state];
        const nameHash = location.name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        
        finalHue = (stateColors.baseHue + (nameHash % 60) - 30) % 360;
        finalSaturation = Math.min(80, stateColors.saturation + (nameHash % 20));
        finalLightness = Math.max(20, Math.min(80, stateColors.lightness + (nameHash % 15) - 7));
        
        console.log('Using state-based colors for:', location.state);
      } else {
        // 4. Use coordinate-based colors as fallback
        const lat = parseFloat(location.latitude) || 0;
        const lng = parseFloat(location.longitude) || 0;
        
        // Base coordinate hash
        const coordHash = Math.abs(lat * 1000 + lng * 1000) % 360;
        
        // Neighborhood grid variation (300m grid cells)
        const gridSize = 0.003; // ~300m
        const gridLat = Math.round(lat / gridSize) * gridSize;
        const gridLng = Math.round(lng / gridSize) * gridSize;
        const neighborhoodHash = Math.abs(gridLat * 1000 + gridLng * 1000) % 360;
        
        // Geohash-based variation (6-character precision)
        const geohash = encodeGeohash(lat, lng, 6);
        const geohashHash = geohash.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 360;
        
        // Combine variations for more distinct neighborhood colors
        const combinedHue = (coordHash + neighborhoodHash + geohashHash) % 360;
        
        const latVariation = Math.abs(lat) % 30;
        const lngVariation = Math.abs(lng) % 30;
        
        finalHue = combinedHue;
        finalSaturation = Math.max(30, Math.min(80, 50 + latVariation));
        finalLightness = Math.max(25, Math.min(70, 45 + lngVariation));
        
        console.log('🎨 Using coordinate-based colors:');
        console.log('📍 Coordinates:', { lat, lng });
        console.log('🏘️ Neighborhood grid:', { gridLat: gridLat.toFixed(6), gridLng: gridLng.toFixed(6) });
        console.log('🗺️ Geohash:', geohash);
        console.log('🎯 Hash values:', { 
          coordHash: coordHash.toFixed(1), 
          neighborhoodHash: neighborhoodHash.toFixed(1), 
          geohashHash: geohashHash.toFixed(1),
          combinedHue: finalHue.toFixed(1)
        });
        console.log('🎨 Final values:', { 
          hue: finalHue.toFixed(1), 
          saturation: finalSaturation.toFixed(1), 
          lightness: finalLightness.toFixed(1) 
        });
      }
    }
    
    // Generate color palette
    const primaryHsl = `hsl(${finalHue}, ${finalSaturation}%, ${finalLightness}%)`;
    const secondaryHsl = `hsl(${(finalHue + 30) % 360}, ${Math.max(30, finalSaturation - 20)}%, ${Math.min(70, finalLightness + 15)}%)`;
    const accentHsl = `hsl(${(finalHue + 180) % 360}, ${Math.min(90, finalSaturation + 10)}%, ${Math.max(40, finalLightness - 10)}%)`;
    
    return {
      primary: primaryHsl,
      secondary: secondaryHsl,
      accent: accentHsl,
      background: `hsl(${finalHue}, ${Math.max(10, finalSaturation - 40)}%, ${Math.min(95, finalLightness + 40)}%)`,
      text: `hsl(${finalHue}, ${Math.max(20, finalSaturation - 30)}%, ${Math.max(15, finalLightness - 30)}%)`
    };
  }

  // Apply location theme to the page
  function applyLocationTheme(location) {
    const colors = generateLocationColors(location);
    console.log('Applying theme colors:', colors);
    
    // Apply to document root for CSS custom properties
    document.documentElement.style.setProperty('--location-primary', colors.primary);
    document.documentElement.style.setProperty('--location-secondary', colors.secondary);
    document.documentElement.style.setProperty('--location-accent', colors.accent);
    document.documentElement.style.setProperty('--location-background', colors.background);
    document.documentElement.style.setProperty('--location-text', colors.text);
    
    // Add location theme class to body
    document.body.classList.add('location-themed');
  }

  // Update location display in header
  function updateLocationDisplay(location) {
    const logo = document.querySelector('#logo');
    if (logo) {
      // Remove any existing location display
      const existingLocation = logo.querySelector('.location-display');
      if (existingLocation) {
        existingLocation.remove();
      }
      
      const locationText = document.createElement('span');
      locationText.className = 'location-display';
      locationText.textContent = `@${location.name}`;
      locationText.style.color = 'var(--text)';
      locationText.style.fontSize = '0.8em';
      locationText.style.fontWeight = '400';
      locationText.style.marginLeft = '8px';
      locationText.style.opacity = '0.7';
      
      logo.appendChild(locationText);
      console.log('Location display added:', location.name);
    } else {
      console.log('Logo not found for location display');
    }
  }

  // Update color preview UI with new location colors
  function updateColorPreview(colors) {
    console.log('Updating color preview with:', colors);
    
    // Update zen colors container
    const zenColorsContainer = document.getElementById('zen-colors');
    if (zenColorsContainer) {
      console.log('Found zen colors container, clearing existing colors...');
      // Clear existing colors
      zenColorsContainer.innerHTML = '';
      
      // Add new colors
      colors.forEach((color, index) => {
        const colorElement = document.createElement('div');
        colorElement.className = 'zen-color-swatch';
        colorElement.style.backgroundColor = color;
        colorElement.setAttribute('data-color', color);
        colorElement.setAttribute('data-index', index);
        
        // Add click handler
        colorElement.addEventListener('click', () => {
          // Track color change
          if (typeof umami !== 'undefined') {
            umami.track('color_changed', { 
              color: color, 
              color_index: index 
            });
          }
          
          // Remove active class from all colors
          document.querySelectorAll('.zen-color-swatch').forEach(el => el.classList.remove('active'));
          // Add active class to clicked color
          colorElement.classList.add('active');
          
          // Update brush color
          if (window.watercolorBrush) {
            window.watercolorBrush.setColor(index);
          }
          
          // Update stroke color for compatibility
          if (window.strokeColor !== undefined) {
            window.strokeColor = color;
          }
          
          // Dispatch custom event for color picker
          document.dispatchEvent(new CustomEvent('colorSelected', {
            detail: { color: color, index: index }
          }));
        });
        
        zenColorsContainer.appendChild(colorElement);
      });
      
      // Set first color as active
      if (zenColorsContainer.firstChild) {
        zenColorsContainer.firstChild.classList.add('active');
      }
      
      console.log('Color preview updated with', colors.length, 'colors');
      
      // Wait for colors to be fully rendered and visible before showing toolbar
      let checkCount = 0;
      const maxChecks = 20; // Maximum 1 second of checking (20 * 50ms)
      
      const waitForColors = () => {
        checkCount++;
        const colorElements = zenColorsContainer.querySelectorAll('.zen-color-swatch');
        
        console.log(`Color check ${checkCount}: Found ${colorElements.length} color elements`);
        
        if (colorElements.length > 0) {
          // Check if at least one color element is actually visible
          let colorsVisible = false;
          for (let i = 0; i < colorElements.length; i++) {
            const element = colorElements[i];
            const rect = element.getBoundingClientRect();
            console.log(`Color ${i}: width=${rect.width}, height=${rect.height}`);
            if (rect.width > 0 && rect.height > 0) {
              colorsVisible = true;
              break;
            }
          }
          
          if (colorsVisible) {
            console.log('Colors are visible, showing toolbar');
            // Colors are visible, now show toolbar and hide loading
            showToolbar();
            hideToolbarLoading();
          } else if (checkCount < maxChecks) {
            // Colors not visible yet, check again
            setTimeout(waitForColors, 50);
          } else {
            // Timeout reached, show toolbar anyway
            console.log('Timeout reached, showing toolbar with colors');
            showToolbar();
            hideToolbarLoading();
          }
        } else if (checkCount < maxChecks) {
          // Colors not ready yet, check again
          setTimeout(waitForColors, 50);
        } else {
          // Timeout reached, show toolbar anyway
          console.log('Timeout reached, showing toolbar without colors');
          showToolbar();
          hideToolbarLoading();
        }
      };
      
      // Start checking for colors
      setTimeout(waitForColors, 50);
      
    } else {
      console.log('Zen colors container not found - will retry');
      // Retry after a short delay if container not found
      setTimeout(() => {
        const retryContainer = document.getElementById('zen-colors');
        if (retryContainer) {
          console.log('Zen colors container found on retry, updating...');
          updateColorPreview(colors);
        } else {
          console.log('Zen colors container still not found after retry');
        }
      }, 500);
    }
    
    // Update current color display
    const currentColorDiv = document.querySelector('.current-color');
    if (currentColorDiv && colors.length > 0) {
      currentColorDiv.style.backgroundColor = colors[0];
      console.log('Current color display updated to:', colors[0]);
    }
  }

  // Convert HSL to RGB for canvas compatibility
  function hslToRgb(h, s, l) {
    h = h / 360;
    s = s / 100;
    l = l / 100;
    
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let r, g, b;
    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  // Parse HSL string and convert to RGB
  function parseHslToRgb(hslString) {
    const match = hslString.match(/hsl\(([^,]+),\s*([^%]+)%,\s*([^%]+)%\)/);
    if (!match) return '#000000'; // fallback to black
    
    const h = parseFloat(match[1]);
    const s = parseFloat(match[2]);
    const l = parseFloat(match[3]);
    
    const rgb = hslToRgb(h, s, l);
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  // Convert RGB to hex format
  function rgbToHex(r, g, b) {
    const toHex = (n) => {
      const hex = Math.round(n).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Parse HSL and convert to hex
  function parseHslToHex(hslString) {
    const match = hslString.match(/hsl\(([^,]+),\s*([^%]+)%,\s*([^%]+)%\)/);
    if (!match) return '#000000'; // fallback to black
    
    const h = parseFloat(match[1]);
    const s = parseFloat(match[2]);
    const l = parseFloat(match[3]);
    
    const rgb = hslToRgb(h, s, l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  // Apply location-based ink colors to the brush
  function applyLocationInkColors(location) {
    console.log('Applying location ink colors for:', location.name);
    
    const colors = generateLocationColors(location);
    console.log('Generated location colors:', colors);
    
    // Convert HSL colors to hex for canvas compatibility
    let inkPalette;
    
    // Check if this is a coordinate-based virtual location
    if (location.name === 'Your Location') {
      // For coordinate-based colors, keep zen colors for 1&2, use coordinate colors for 3&4
      inkPalette = [
        '#000000', // Zen black (Color 1)
        '#333333', // Zen dark gray (Color 2)
        parseHslToHex(colors.accent), // Coordinate-based accent (Color 3)
        parseHslToHex(colors.secondary), // Coordinate-based secondary (Color 4)
        parseHslToHex(colors.text)        // Dark coordinate color (Color 5)
      ];
        console.log('🎨 Using hybrid zen + coordinate colors');
      } else {
        // For real locations, use full location-based palette
        inkPalette = [
          parseHslToHex(colors.primary),
          parseHslToHex(colors.secondary), 
          parseHslToHex(colors.accent),
          parseHslToHex(colors.background),
          parseHslToHex(colors.text)
        ];
        console.log('🎨 Using full location-based colors');
      }
    
    console.log('Ink palette created (hex):', inkPalette);
    
    // Try to create the brush manually if it doesn't exist
    if (!window.watercolorBrush) {
      console.log('Watercolor brush not found, attempting to create manually...');
      try {
        const canvas = document.getElementById('canvas');
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx && typeof WatercolorBrush !== 'undefined') {
            window.watercolorBrush = new WatercolorBrush(canvas, ctx);
            console.log('Manual watercolor brush created');
          } else {
            console.log('Canvas context or WatercolorBrush class not available');
          }
        } else {
          console.log('Canvas element not found');
        }
      } catch (error) {
        console.error('Error creating manual brush:', error);
      }
    }
    
    // Apply colors if brush is available
    if (window.watercolorBrush) {
      console.log('Watercolor brush object:', window.watercolorBrush);
      console.log('Available methods:', Object.getOwnPropertyNames(window.watercolorBrush));
      console.log('Current zenColors:', window.watercolorBrush.zenColors);
      
      // Try to set the colors directly on the zenColors array
      try {
        window.watercolorBrush.zenColors = inkPalette;
        window.watercolorBrush.currentColorIndex = 0;
        window.watercolorBrush.currentColor = inkPalette[0];
        
        // Color cycling disabled - colors stay static until manually changed
        
        console.log('Location ink colors applied directly to zenColors:', inkPalette);
        console.log('Updated zenColors:', window.watercolorBrush.zenColors);
        console.log('Current color set to:', window.watercolorBrush.currentColor);
        console.log('Shuffle functionality available (disabled by default)');
        
        // Apply location theming
        applyLocationTheming(colors);
        
        // Update the color preview UI with a small delay to ensure DOM is ready
        setTimeout(() => {
          updateColorPreview(inkPalette);
        }, 100);
      } catch (error) {
        console.error('Error setting colors directly:', error);
      }
    } else {
      console.log('Cannot apply location colors - brush not available');
      console.log('WatercolorBrush class available:', typeof WatercolorBrush !== 'undefined');
      console.log('Canvas available:', !!document.getElementById('canvas'));
    }
  }

  // Try to apply the pending location palette
  let retryCount = 0;
  const maxRetries = 20; // Stop after 10 seconds (20 * 500ms)
  
  function tryApplyLocationPalette() {
    retryCount++;
    console.log(`Checking watercolor brush availability... (attempt ${retryCount}/${maxRetries})`);
    console.log('Pending palette exists:', !!window.pendingLocationPalette);
    console.log('Watercolor brush exists:', !!window.watercolorBrush);
    console.log('setLocationPalette method exists:', !!(window.watercolorBrush && typeof window.watercolorBrush.setLocationPalette === 'function'));
    
    if (window.pendingLocationPalette && window.watercolorBrush && typeof window.watercolorBrush.setLocationPalette === 'function') {
      window.watercolorBrush.setLocationPalette(window.pendingLocationPalette);
      console.log('Location ink colors applied successfully:', window.pendingLocationPalette);
      window.pendingLocationPalette = null; // Clear after successful application
    } else if (retryCount >= maxRetries) {
      console.log('Max retries reached. Watercolor brush is not available.');
      console.log('Sketch loaded:', !!window.sketchLoaded);
      console.log('Available scripts:', Object.keys(window).filter(key => key.includes('watercolor') || key.includes('brush')));
      window.pendingLocationPalette = null; // Clear to stop retrying
    } else {
      console.log('Watercolor brush not ready, will retry...');
      // Retry every 500ms until successful
      setTimeout(tryApplyLocationPalette, 500);
    }
  }

  // Calculate distance between two coordinates (Haversine formula)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  // Initialize shape generator
  function initShapeGenerator() {
    if (!window.shapeGenerator) {
      const canvas = document.getElementById('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        window.shapeGenerator = new ShapeGenerator(canvas, ctx);
        console.log('Shape generator initialized for v2');
      }
    }
  }

  // Clear the canvas
  function clearCanvas() {
    const canvas = document.getElementById('canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      console.log('Canvas cleared');
    }
  }

  // Select prompt using weighted selection
  function selectWeightedPrompt(prompts) {
    if (!prompts || prompts.length === 0) {
      return null;
    }

    // Create weighted array where each prompt appears 'weight' times
    const weightedArray = [];
    prompts.forEach(prompt => {
      const weight = prompt.weight || 1; // Default weight of 1 if not specified
      for (let i = 0; i < weight; i++) {
        weightedArray.push(prompt);
      }
    });
    
    // Select random from weighted array
    const randomIndex = Math.floor(Math.random() * weightedArray.length);
    const selectedPrompt = weightedArray[randomIndex];
    
    console.log('Weighted selection:', {
      totalPrompts: prompts.length,
      totalWeight: weightedArray.length,
      selectedWeight: selectedPrompt.weight || 1,
      selectedPrompt: selectedPrompt.content
    });
    
    return selectedPrompt;
  }

  // Generate shape for complete_shape prompts
  function generateShapeForPrompt() {
    const canvas = document.getElementById('canvas');
    if (!canvas) {
      console.error('Canvas not found for shape generation');
      return;
    }

    // Ensure shape generator is initialized
    if (!window.shapeGenerator) {
      console.log('Initializing shape generator for prompt...');
      const ctx = canvas.getContext('2d');
      window.shapeGenerator = new ShapeGenerator(canvas, ctx);
    }

    if (window.shapeGenerator) {
      try {
        // Generate a random organic shape with fade-in animation
        window.shapeGenerator.generateShapeWithFade();
        console.log('Shape generated successfully for complete_shape prompt');
        
        // Show visual feedback
        if (typeof window.showToast === 'function') {
          setTimeout(() => {
            window.showToast('A shape has appeared for you to complete...');
          }, 1000);
        }
      } catch (error) {
        console.error('Error generating shape:', error);
        // Fallback: try to generate a basic shape
        try {
          window.shapeGenerator.drawOrganicCircle(
            canvas.width / 2, 
            canvas.height / 2, 
            Math.random() * 100 + 50, 
            Math.random() * 200 + 100, 
            Math.random() * 200 + 100
          );
          console.log('Fallback shape generated');
        } catch (fallbackError) {
          console.error('Fallback shape generation failed:', fallbackError);
        }
      }
    } else {
      console.error('Shape generator not available');
    }
  }

  // Load a new prompt
  async function loadNewPrompt() {
    console.log('Loading new prompt...');
    
    // Stop any current animations
    stopAllAnimations();
    
    // Clear the canvas first
    clearCanvas();
    
    try {
      const prompt = await fetchPrompt();
      if (prompt) {
        displayPrompt(prompt);
        handlePromptType(prompt);
        trackPromptUsage(prompt);
      } else {
        // Fallback to generic prompt
        const fallbackPrompt = getFallbackPrompt();
        displayPrompt({ content: fallbackPrompt, category: 'generative' });
      }
    } catch (error) {
      console.error('Error loading prompt:', error);
      const fallbackPrompt = getFallbackPrompt();
      displayPrompt({ content: fallbackPrompt, category: 'generative' });
    }
  }

  // Add timeout wrapper for Supabase calls
  async function withTimeout(promise, timeoutMs = 5000) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
  }

  // Fetch prompt from database
  async function fetchPrompt() {
    if (typeof window.supabaseClient === 'undefined' || window.supabaseClient === null) {
      console.log('⚠️ Supabase not available, using fallback');
      return null;
    }
    
    try {
      console.log('📡 Fetching prompt from Supabase...');
      let query = window.supabaseClient
        .from('prompts')
        .select('id, content, category, requires_shape, requires_gallery_image, location_id, weight')
        .eq('active', true);
      
      // Add location filter if we have a current location
      if (currentLocation) {
        query = query.eq('location_id', currentLocation.id);
      } else {
        query = query.is('location_id', null);
      }
      
      // Avoid showing prompts from session history
      if (sessionPromptHistory.length > 0) {
        console.log('Excluding prompts from history:', sessionPromptHistory);
        // Use individual neq() calls for each ID to avoid syntax issues
        for (const id of sessionPromptHistory) {
          query = query.neq('id', id);
        }
      }
      
      // Also avoid the last prompt specifically
      if (lastPromptId) {
        query = query.neq('id', lastPromptId);
      }
      
      const { data, error } = await withTimeout(query.limit(50), 5000);
      
      if (error) {
        console.error('❌ Error fetching prompt:', error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        console.log('⚠️ Network error detected, using fallback prompt');
        return null;
      }
      
      if (data && data.length > 0) {
        // Prioritize categories that haven't been used recently
        const availableCategories = [...new Set(data.map(p => p.category))];
        const recentCategories = categoryHistory.slice(-3); // Last 3 categories
        const preferredCategories = availableCategories.filter(cat => !recentCategories.includes(cat));
        
        let filteredData = data;
        if (preferredCategories.length > 0) {
          // Prefer categories that haven't been used recently
          filteredData = data.filter(p => preferredCategories.includes(p.category));
          console.log('Preferring categories:', preferredCategories);
        }
        
        // Select prompt using weighted selection
        const prompt = selectWeightedPrompt(filteredData);
        console.log('Selected prompt:', prompt.content, 'Category:', prompt.category, 'Weight:', prompt.weight, 'ID:', prompt.id);
        lastPromptId = prompt.id;
        return prompt;
      }
      
      // If no location-specific prompts found, try generic ones
      if (currentLocation) {
        console.log('No location-specific prompts found, trying generic prompts');
        let genericQuery = window.supabaseClient
          .from('prompts')
          .select('id, content, category, requires_shape, requires_gallery_image, location_id, weight')
          .eq('active', true)
          .is('location_id', null);
        
        // Apply same history exclusions to generic prompts
        if (sessionPromptHistory.length > 0) {
          for (const id of sessionPromptHistory) {
            genericQuery = genericQuery.neq('id', id);
          }
        }
        if (lastPromptId) {
          genericQuery = genericQuery.neq('id', lastPromptId);
        }
        
        const { data: genericData, error: genericError } = await genericQuery.limit(50);
        
        if (!genericError && genericData && genericData.length > 0) {
          const prompt = selectWeightedPrompt(genericData);
          console.log('Selected generic prompt:', prompt.content, 'Weight:', prompt.weight, 'ID:', prompt.id);
          lastPromptId = prompt.id;
          return prompt;
        }
      }
      
      // If we still have no prompts, clear history and try again
      if (sessionPromptHistory.length > 0) {
        console.log('No available prompts, clearing history and retrying...');
        sessionPromptHistory = [];
        const historyKey = `driftpad_prompt_history_${sessionId}`;
        localStorage.removeItem(historyKey);
        
        // Retry the original query without history exclusions
        const retryQuery = window.supabaseClient
          .from('prompts')
          .select('id, content, category, requires_shape, requires_gallery_image, location_id, weight')
          .eq('active', true);
        
        if (currentLocation) {
          retryQuery.eq('location_id', currentLocation.id);
        } else {
          retryQuery.is('location_id', null);
        }
        
        const { data: retryData, error: retryError } = await retryQuery.limit(50);
        
        if (!retryError && retryData && retryData.length > 0) {
          const prompt = selectWeightedPrompt(retryData);
          console.log('Selected prompt after history reset:', prompt.content, 'Weight:', prompt.weight, 'ID:', prompt.id);
          lastPromptId = prompt.id;
          return prompt;
        }
      }
      
      return null;
    } catch (err) {
      console.error('Error in fetchPrompt:', err);
      return null;
    }
  }

  // Display the prompt
  function displayPrompt(prompt) {
    const target = document.querySelector('.prompt');
    if (target) {
      target.textContent = prompt.content;
      currentPrompt = prompt;
      console.log('Prompt displayed:', prompt.content, 'Category:', prompt.category);
    }
  }

  // Handle different prompt types
  function handlePromptType(prompt) {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    console.log('Handling prompt type:', prompt.category, 'requires_shape:', prompt.requires_shape, 'requires_gallery:', prompt.requires_gallery_image);
    
    // Clear canvas first
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    switch (prompt.category) {
      case 'complete_shape':
        if (prompt.requires_shape) {
          console.log('Generating shape for complete_shape prompt:', prompt.content);
          isAnimating = true;
          setButtonsEnabled(false);
          showLoadingIndicator('shape');
          setAnimationTimeout(); // Fallback timeout
          generateShapeForPrompt();
        } else {
          console.log('Complete shape prompt but requires_shape is false:', prompt.content);
        }
        break;
        
      case 'erase':
        if (prompt.requires_gallery_image) {
          console.log('Loading gallery image for erase prompt');
          isAnimating = true;
          setButtonsEnabled(false);
          showLoadingIndicator('image');
          setAnimationTimeout(); // Fallback timeout
          loadGalleryImage('erase');
        }
        break;
        
      case 'add_to_drawing':
        if (prompt.requires_gallery_image) {
          console.log('Loading gallery image for add_to_drawing prompt');
          isAnimating = true;
          setButtonsEnabled(false);
          showLoadingIndicator('image');
          setAnimationTimeout(); // Fallback timeout
          loadGalleryImage('add');
        }
        break;
        
      default:
        // For generative and subject prompts, just show the prompt
        console.log('Generic prompt, no special handling needed');
        break;
    }
  }

  // Load gallery image for erase/add prompts
  async function loadGalleryImage(type) {
    const startTime = performance.now();
    console.log('Starting gallery image load for type:', type);
    
    if (typeof window.supabaseClient === 'undefined' || window.supabaseClient === null) {
      console.log('⚠️ Supabase not available for gallery image');
      return;
    }
    
    const canvas = document.getElementById('canvas');
    if (!canvas) {
      console.error('Canvas not found for gallery image');
      return;
    }
    
    try {
      const column = type === 'erase' ? 'is_erase_eligible' : 'is_add_eligible';
      console.log('Querying drawings table for column:', column);
      
      const queryStart = performance.now();
      const { data, error } = await withTimeout(
        window.supabaseClient
          .from('drawings')
          .select('id, image_data, title, description')
          .eq('is_public', true)
          .eq(column, true)
          .limit(10), // Get multiple options for better selection
        8000 // Increased timeout for gallery images (8 seconds)
      );
      
      const queryTime = performance.now() - queryStart;
      console.log('Database query took:', queryTime, 'ms');
      
      if (error) {
        console.error('Error loading gallery image:', error);
        console.log('Database query failed, showing fallback message');
        showGalleryTimeoutMessage();
        return;
      }
      
      if (data && data.length > 0) {
        // Select random image from results
        const randomIndex = Math.floor(Math.random() * data.length);
        const image = data[randomIndex];
        console.log('Gallery image selected:', image);
        console.log('Available columns:', Object.keys(image));
        
        // Load and display the image
        const imageStart = performance.now();
        await displayGalleryImage(image, canvas, type);
        const imageTime = performance.now() - imageStart;
        console.log('Image loading and display took:', imageTime, 'ms');
        
        const totalTime = performance.now() - startTime;
        console.log('Total gallery image load time:', totalTime, 'ms');
      } else {
        console.log('No gallery images available for type:', type);
      }
    } catch (err) {
      console.error('Error in loadGalleryImage:', err);
      
      // Handle timeout or network errors gracefully
      if (err.message === 'Request timeout') {
        console.log('Gallery image loading timed out after 8 seconds');
        console.log('This could be due to:');
        console.log('1. Large base64 images taking too long to load');
        console.log('2. Slow network connection to Supabase');
        console.log('3. Database query taking too long');
        showGalleryTimeoutMessage();
      } else {
        console.log('Gallery image loading failed:', err.message);
        showGalleryTimeoutMessage();
      }
    }
  }

  // Display gallery image on canvas
  async function displayGalleryImage(image, canvas, type) {
    return new Promise((resolve, reject) => {
      const imgLoadStart = performance.now();
      console.log('Starting image load from base64 data...');
      
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Handle CORS if needed
      
      img.onload = () => {
        const imgLoadTime = performance.now() - imgLoadStart;
        console.log('Image loaded in:', imgLoadTime, 'ms');
        const ctx = canvas.getContext('2d');
        
        // Clear canvas first
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Use the same approach as shape generator for consistency
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const visibleWidth = rect.width;
        const visibleHeight = rect.height;
        
        // Calculate scaling to fit image in the visible canvas area
        const scaleX = visibleWidth / img.width;
        const scaleY = visibleHeight / img.height;
        const scale = Math.min(scaleX, scaleY, 1); // Don't scale up
        
        // Adjust size reduction based on device
        const isMobile = window.innerWidth <= 768;
        const sizeReduction = isMobile ? 0.9 : 0.7; // Less reduction on mobile (10% vs 30%)
        const reducedScale = scale * sizeReduction;
        
        // Additional mobile boost if needed
        const mobileScaleMultiplier = isMobile ? 1.2 : 1.0; // 20% larger on mobile
        const adjustedScale = reducedScale * mobileScaleMultiplier;
        
        // Ensure minimum scale so very small images are still visible
        const minScale = isMobile ? 0.38 : 0.1; // 5% smaller than 0.4 (0.4 * 0.95 = 0.38)
        const finalScale = Math.max(adjustedScale, minScale);
        
        const scaledWidth = img.width * finalScale;
        const scaledHeight = img.height * finalScale;
        
        // Center using the same logic as shape generator
        const centerX = canvas.width / 2 / dpr;
        const centerY = canvas.height / 2 / dpr;
        
        const x = Math.round(centerX - scaledWidth / 2);
        const y = Math.round(centerY - scaledHeight / 2);
        
        console.log('Image scaling:', {
          originalSize: `${img.width}x${img.height}`,
          canvasSize: `${canvas.width}x${canvas.height}`,
          visibleSize: `${visibleWidth}x${visibleHeight}`,
          devicePixelRatio: dpr,
          isMobile: isMobile,
          originalScale: scale,
          sizeReduction: sizeReduction,
          mobileScaleMultiplier: mobileScaleMultiplier,
          finalScale: finalScale,
          scaledSize: `${scaledWidth}x${scaledHeight}`,
          position: `(${x}, ${y})`,
          centeringCalc: {
            centerX: centerX,
            centerY: centerY,
            finalX: x,
            finalY: y
          }
        });
        
        // Draw the image with fade-in and smooth drift effect
        let opacity = 0;
        let driftX = 0;
        let driftY = 0;
        let targetDriftX = 0;
        let targetDriftY = 0;
        let driftCounter = 0;
        const maxDrift = 8; // Increased to 8px for more noticeable drift
        
        currentAnimationInterval = setInterval(() => {
            opacity += 0.025; // Fade in over 2 seconds (80 steps * 25ms)
            
            // Smooth drift effect - gradually move towards new target
            driftCounter++;
            if (driftCounter % 15 === 0) { // Change target every 15 frames
                targetDriftX = (Math.random() - 0.5) * maxDrift;
                targetDriftY = (Math.random() - 0.5) * maxDrift;
            }
            
            // Smooth interpolation towards target
            driftX += (targetDriftX - driftX) * 0.1;
            driftY += (targetDriftY - driftY) * 0.1;
            
            // Clear and redraw with new opacity and drift
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = opacity;
            ctx.save();
            ctx.translate(driftX, driftY);
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            ctx.restore();
            
            if (opacity >= 1) {
                clearInterval(currentAnimationInterval);
                ctx.globalAlpha = 1;
                ctx.restore();
                currentAnimationInterval = null;
                isAnimating = false;
                setButtonsEnabled(true);
                hideLoadingIndicator();
            }
        }, 25); // ~40fps for smooth animation
        
        console.log('Gallery image displayed:', {
          type: type,
          title: image.title,
          dimensions: `${scaledWidth}x${scaledHeight}`,
          position: `(${x}, ${y})`
        });
        
        // Show visual feedback
        if (typeof window.showToast === 'function') {
          const message = type === 'erase' 
            ? 'A drawing has appeared for you to erase and recreate...'
            : 'A drawing has appeared for you to add to...';
          setTimeout(() => {
            window.showToast(message);
          }, 1000);
        }
        
        resolve(image);
      };
      
      img.onerror = (error) => {
        console.error('Error loading image:', error);
        reject(error);
      };
      
      // Load the image (handle both URL and base64 data)
      if (image.image_data) {
        // If it's base64 data, use it directly
        img.src = image.image_data;
      } else if (image.image_url) {
        // If it's a URL, use that
        img.src = image.image_url;
      } else {
        console.error('No image data found in drawing:', image);
        reject(new Error('No image data available'));
        return;
      }
    });
  }

  // Track prompt usage
  function trackPromptUsage(prompt) {
    // Add to session history
    if (prompt.id && !sessionPromptHistory.includes(prompt.id)) {
      sessionPromptHistory.push(prompt.id);
      
      // Keep only last 10 prompts to allow more variation
      if (sessionPromptHistory.length > 10) {
        sessionPromptHistory = sessionPromptHistory.slice(-10);
      }
      
      // Save to localStorage
      const historyKey = `driftpad_prompt_history_${sessionId}`;
      localStorage.setItem(historyKey, JSON.stringify(sessionPromptHistory));
      
      console.log('Prompt added to history:', prompt.content, 'Total history:', sessionPromptHistory.length);
    }
    
    // Track category for variation
    if (prompt.category) {
      categoryHistory.push(prompt.category);
      // Keep only last 5 categories
      if (categoryHistory.length > 5) {
        categoryHistory = categoryHistory.slice(-5);
      }
      console.log('Category history:', categoryHistory);
    }
    
    // Update session tracking
    if (window.feedbackCollector && typeof window.feedbackCollector.trackPromptUsage === 'function') {
      window.feedbackCollector.trackPromptUsage(prompt);
    }
    
    // Track with analytics
    if (typeof umami !== 'undefined') {
      umami.track('prompt_loaded', {
        category: prompt.category,
        location: currentLocation ? currentLocation.slug : 'generic',
        requires_shape: prompt.requires_shape,
        requires_gallery: prompt.requires_gallery_image
      });
    }
  }

  // Get fallback prompt
  function getFallbackPrompt() {
    const fallbackPrompts = [
      'draw with your eyes closed',
      'draw with only one line',
      'draw what\'s in front of you',
      'draw your last dream',
      'do scribbles',
      'try to fill up the page',
      'draw something with a shadow',
      'draw a cat',
      'draw a tree',
      'draw a face'
    ];
    
    // Avoid repeating fallback prompts in the same session
    const fallbackHistoryKey = `driftpad_fallback_history_${sessionId}`;
    const storedFallbackHistory = localStorage.getItem(fallbackHistoryKey);
    let fallbackHistory = storedFallbackHistory ? JSON.parse(storedFallbackHistory) : [];
    
    // Filter out recently used fallback prompts
    const availablePrompts = fallbackPrompts.filter(prompt => !fallbackHistory.includes(prompt));
    
    // If all prompts have been used, reset the history
    if (availablePrompts.length === 0) {
      fallbackHistory = [];
      availablePrompts.push(...fallbackPrompts);
    }
    
    // Select a random prompt from available ones
    const selectedPrompt = availablePrompts[Math.floor(Math.random() * availablePrompts.length)];
    
    // Add to history
    fallbackHistory.push(selectedPrompt);
    if (fallbackHistory.length > 10) {
      fallbackHistory = fallbackHistory.slice(-10);
    }
    localStorage.setItem(fallbackHistoryKey, JSON.stringify(fallbackHistory));
    
    return selectedPrompt;
  }

  // Callback for when shape animation completes
  function onShapeAnimationComplete() {
    console.log('Shape animation completed, re-enabling buttons');
    isAnimating = false;
    setButtonsEnabled(true);
    hideLoadingIndicator();
  }
  
  // Fallback timeout to ensure buttons get re-enabled
  function setAnimationTimeout() {
    setTimeout(() => {
      if (isAnimating) {
        console.log('Animation timeout reached, force re-enabling buttons');
        isAnimating = false;
        setButtonsEnabled(true);
      }
    }, 3000); // 3 seconds fallback
  }

  // Public API
  window.DriftpadV2 = {
    loadNewPrompt,
    getCurrentPrompt: () => currentPrompt,
    getCurrentLocation: () => currentLocation,
    getSessionId: () => sessionId,
    generateShapeForPrompt,
    clearCanvas,
    selectWeightedPrompt,
    loadGalleryImage,
    displayGalleryImage,
    onShapeAnimationComplete,
    // Debug functions
    testBrushColors: () => {
      console.log('Testing brush colors...');
      if (window.watercolorBrush) {
        console.log('Watercolor brush available:', window.watercolorBrush);
        console.log('Current colors:', window.watercolorBrush.zenColors);
        console.log('setLocationPalette method:', typeof window.watercolorBrush.setLocationPalette);
      } else {
        console.log('Watercolor brush not available');
      }
    },
    applyTestColors: () => {
      if (window.watercolorBrush && typeof window.watercolorBrush.setLocationPalette === 'function') {
        const testColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
        window.watercolorBrush.setLocationPalette(testColors);
        console.log('Test colors applied:', testColors);
      } else {
        console.log('Cannot apply test colors - brush not ready');
      }
    },
    createTestBrush: () => {
      try {
        console.log('Attempting to create watercolor brush manually...');
        const canvas = document.getElementById('canvas');
        if (!canvas) {
          console.log('Canvas not found');
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.log('Canvas context not found');
          return;
        }
        
        // Try to create the brush manually
        const brush = new WatercolorBrush(canvas, ctx);
        window.watercolorBrush = brush;
        console.log('Manual brush created:', brush);
        console.log('setLocationPalette method:', typeof brush.setLocationPalette);
        
        // Test with colors
        const testColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
        brush.setLocationPalette(testColors);
        console.log('Test colors applied to manual brush:', testColors);
        
      } catch (error) {
        console.error('Error creating manual brush:', error);
      }
    }
  };

  // Listen for Supabase ready event as backup
  window.addEventListener('supabaseReady', () => {
    console.log('📡 Supabase ready event received');
    // If init hasn't run yet, it will pick up the client
    // If it's already waiting, waitForSupabase will detect it
  });

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
