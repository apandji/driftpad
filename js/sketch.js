console.log('Sketch.js script starting...');

document.addEventListener('DOMContentLoaded', function() {
  console.log('Sketch.js DOMContentLoaded event fired');
  // Prevent scrolling and zooming only within the canvas (scoped below)
  
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Prevent double-tap zoom and improve mobile touch handling
  let lastCanvasTouchEnd = 0;
  canvas.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - lastCanvasTouchEnd <= 300) {
      e.preventDefault();
    }
    lastCanvasTouchEnd = now;
  }, { passive: false });

  // Mobile touch improvements are handled by the main touch event handlers below

  // Elements
  const colorInput = document.getElementById('color');
  const sizeInput = document.getElementById('size');
  const clearBtn = document.getElementById('clear');
  const saveBtn = document.getElementById('save');
  const cursor = document.getElementById('cursor');
  
  // New color picker elements
  const colorPickerBtn = document.getElementById('color-picker-btn');
  const currentColorDiv = document.getElementById('current-color');
  const colorPopup = document.getElementById('color-popup');
  
  // New tool and size picker elements
  const toolBtn = document.getElementById('tool-btn');
  const sizePickerBtn = document.getElementById('size-picker-btn');
  const sizePopup = document.getElementById('size-popup');
  const sizeOptions = document.getElementById('size-options');

  // Initialize watercolor brush and fade timer
  const watercolorBrush = new WatercolorBrush(canvas, ctx);
  const fadeTimer = new FadeTimer(canvas, ctx);
  
  // Make watercolor brush available globally for location colors
  try {
    window.watercolorBrush = watercolorBrush;
    window.sketchLoaded = true;
    console.log('Sketch.js loaded and watercolor brush created');
    console.log('Watercolor brush object:', watercolorBrush);
    console.log('setLocationPalette method:', typeof watercolorBrush.setLocationPalette);
  } catch (error) {
    console.error('Error setting up watercolor brush globally:', error);
  }
  
  // Connect fade timer to watercolor brush
  watercolorBrush.setFadeTimer(fadeTimer);

  // State
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let drawingStartTime = 0;
  let currentMode = 'prompt';
  let strokeColor = colorInput ? colorInput.value : '#000000';
  let strokeWidth = sizeInput ? Number(sizeInput.value) : 15; // Default to 37.5% (15/40) for better mobile finger drawing
  let lastCssWidth = 0;
  let lastCssHeight = 0;
  let lastDpr = 1;
  let lastTime = 0;
  let lastSpeed = 0;
  let currentWidth = strokeWidth;
  
  // Tool and size state
  let currentTool = 'brush'; // 'brush' or 'eraser'
  let currentSize = 'M'; // 'S', 'M', 'L', 'XL'
  
  // Size mappings
  const brushSizes = { S: 2, M: 6, L: 12, XL: 20 };
  const eraserSizes = { S: 4, M: 12, L: 24, XL: 40 };
  
  // Update currentMode when mode changes
  const modeSelect = document.getElementById('prompt-mode');
  if (modeSelect) {
    currentMode = modeSelect.value; // Initialize with current value
    modeSelect.addEventListener('change', () => {
      currentMode = modeSelect.value;
    });
  }

  // Resize handling that preserves drawing content without any scaling
  function resizeCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    
    // On mobile, ensure canvas takes full available space
    let cssWidth = Math.floor(rect.width);
    let cssHeight = Math.floor(rect.height);
    
    // Mobile-specific sizing
    if (window.innerWidth <= 640) {
      const availableHeight = window.innerHeight - 140; // Account for header, prompt, and toolbar
      cssHeight = Math.max(200, Math.floor(availableHeight));
    }

    if (cssWidth === lastCssWidth && cssHeight === lastCssHeight && dpr === lastDpr) {
      return;
    }


    // Save current canvas content as a data URL before resizing
    let savedDataURL = null;
    const hasContent = canvas.width > 0 && canvas.height > 0;
    if (hasContent) {
      try {
        savedDataURL = canvas.toDataURL('image/png');
      } catch (error) {
        console.warn('Failed to save canvas content:', error);
      }
    }

    lastCssWidth = cssWidth;
    lastCssHeight = cssHeight;
    lastDpr = dpr;

    // Set canvas size
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    
    // Set CSS size (for display)
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';

    // Scale context for crisp lines
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Restore canvas content if it existed
    if (savedDataURL) {
      const img = new Image();
      img.onload = function() {
        try {
          // Save the current transformation matrix
          ctx.save();
          
          // Reset the transformation matrix to avoid scaling
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          
          // Draw the image at its original size without any scaling
          ctx.drawImage(img, 0, 0);
          
          // Restore the transformation matrix
          ctx.restore();
          
          console.log('Canvas content restored without scaling');
        } catch (error) {
          console.warn('Failed to restore canvas content:', error);
        }
      };
      img.src = savedDataURL;
    }
  }

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    
    if (evt.touches && evt.touches.length > 0) {
      // Touch event - use the first touch point
      clientX = evt.touches[0].clientX;
      clientY = evt.touches[0].clientY;
    } else if (evt.changedTouches && evt.changedTouches.length > 0) {
      // Handle touchend events
      clientX = evt.changedTouches[0].clientX;
      clientY = evt.changedTouches[0].clientY;
    } else {
      // Mouse event
      clientX = evt.clientX;
      clientY = evt.clientY;
    }
    
    // Simple coordinate calculation - no scaling
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    return { x, y };
  }

  function startDraw(x, y, pressure = 0.5, t = performance.now()) {
    isDrawing = true;
    lastX = x;
    lastY = y;
    lastTime = t;
    lastSpeed = 0;
    drawingStartTime = Date.now();
    currentWidth = computeWidth(pressure, 0);

    // Ambient sound fades in while drawing
    if (window.driftAmbient) window.driftAmbient.drawStart();
    
    // Keep cursor visible during drawing
    if (cursor) cursor.style.display = 'block';
    
    // Start watercolor brush stroke or eraser
    if (currentTool === 'brush') {
      watercolorBrush.startStroke(x, y, pressure);
    } else if (currentTool === 'eraser') {
      // Eraser only affects foreground canvas (user drawings)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1.0; // Full opacity erasing
      ctx.beginPath();
      ctx.arc(x, y, currentWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  function drawTo(x, y, pressure = 0.5, t = performance.now()) {
    if (!isDrawing) return;
    const dt = Math.max(1, t - lastTime);
    const dx = x - lastX;
    const dy = y - lastY;
    const dist = Math.hypot(dx, dy);
    const speed = dist / dt; // px per ms
    // Low-pass filter speed for stability
    const smoothedSpeed = lastSpeed * 0.7 + speed * 0.3;
    lastSpeed = smoothedSpeed;

    const targetWidth = computeWidth(pressure, smoothedSpeed);
    // Smooth the width for an ink-like feel
    currentWidth = currentWidth * 0.6 + targetWidth * 0.4;

    // Continue watercolor brush stroke or eraser
    if (currentTool === 'brush') {
      watercolorBrush.continueStroke(x, y, pressure);
    } else if (currentTool === 'eraser') {
      // Ultra-smooth eraser functionality (only affects foreground canvas)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1.0; // Full opacity erasing
      
      // Create smooth eraser stroke with multiple passes for better coverage
      ctx.beginPath();
      ctx.arc(x, y, currentWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      
      // Add smooth stroke between points
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.lineWidth = currentWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      
      // Add extra coverage for smoother erasing
      ctx.beginPath();
      ctx.arc((lastX + x) / 2, (lastY + y) / 2, currentWidth / 3, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    
    lastX = x;
    lastY = y;
    lastTime = t;
  }

  function endDraw() {
    // Ambient sound fades out a moment after the last stroke
    if (isDrawing && window.driftAmbient) window.driftAmbient.drawEnd();
    isDrawing = false;
    
    // End watercolor brush stroke
    watercolorBrush.endStroke();
    
    // Track drawing completion
    if (window.feedbackCollector) {
      const drawingDuration = Date.now() - (drawingStartTime || Date.now());
      const strokeCount = watercolorBrush.getStrokeCount ? watercolorBrush.getStrokeCount() : 1;
      window.feedbackCollector.trackDrawingCompleted(currentMode, drawingDuration, strokeCount);
    }
    
    
    // Start fade timer if not already active
    if (!fadeTimer.isTimerActive()) {
      fadeTimer.start();
    }
  }

  // Safari-compatible event handling
  function handleStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = getPos(e);
    const pressure = (e.pressure && e.pressure > 0) ? e.pressure : 0.5;
    startDraw(x, y, pressure, e.timeStamp || performance.now());
    drawTo(x + 0.01, y + 0.01, pressure, e.timeStamp || performance.now());
  }

  function handleMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = getPos(e);
    const pressure = (e.pressure && e.pressure > 0) ? e.pressure : 0.5;
    
    // Update cursor position during drawing
    updateCursorPosition(e);
    
    drawTo(x, y, pressure, e.timeStamp || performance.now());
  }

  function handleEnd(e) {
    e.preventDefault();
    endDraw();
  }

  // Primary events (pointer for modern browsers)
  canvas.addEventListener('pointerdown', handleStart);
  canvas.addEventListener('pointermove', handleMove);
  canvas.addEventListener('pointerup', handleEnd);
  canvas.addEventListener('pointercancel', handleEnd);
  canvas.addEventListener('pointerleave', handleEnd);

  // Mouse fallback (for Safari and older browsers)
  canvas.addEventListener('mousedown', handleStart);
  canvas.addEventListener('mousemove', handleMove);
  canvas.addEventListener('mouseup', handleEnd);
  canvas.addEventListener('mouseleave', handleEnd);

  // Touch fallback with improved mobile handling
  canvas.addEventListener('touchstart', handleStart, { passive: false });
  canvas.addEventListener('touchmove', handleMove, { passive: false });
  canvas.addEventListener('touchend', handleEnd, { passive: false });

  // Prevent context menu and scrolling
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('selectstart', (e) => e.preventDefault());

  // Update cursor size based on current tool size
  function updateCursorSize() {
    if (cursor) {
      // Use the actual stroke width for the cursor size
      const size = Math.max(8, strokeWidth);
      cursor.style.width = size + 'px';
      cursor.style.height = size + 'px';
    }
  }

  // Mouse/touch tracking for cursor
  function updateCursorPosition(e) {
    if (!cursor) return;
    const canvasRect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    
    if (e.touches && e.touches.length > 0) {
      // Touch event
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      // Handle touchend events
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      // Mouse event
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    // Simple position calculation - no scaling
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;
    
    cursor.style.left = x + 'px';
    cursor.style.top = y + 'px';
  }

  // Controls
  if (colorInput) {
    colorInput.addEventListener('input', (e) => {
      strokeColor = e.target.value;
      // Update watercolor brush color (convert to zen palette index)
      const zenColors = watercolorBrush.getZenColors();
      const colorIndex = zenColors.indexOf(e.target.value);
      if (colorIndex !== -1) {
        watercolorBrush.setColor(colorIndex);
      }
    });
  }
  // Old size input disabled - now using size picker system
  // if (sizeInput) {
  //   sizeInput.addEventListener('input', (e) => {
  //     strokeWidth = Number(e.target.value);
  //     watercolorBrush.setSize(strokeWidth);
  //     updateCursorSize();
  //   });
  //   
  //   // Track brush size change only when user finishes adjusting
  //   sizeInput.addEventListener('change', (e) => {
  //     strokeWidth = Number(e.target.value);
  //     
  //     // Track brush size change
  //     umami.track('brush_size_changed', { 
  //       size: strokeWidth,
  //       size_percentage: Math.round((strokeWidth / 40) * 100)
  //     });
  //   });
  // }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      // Check if we're in Complete Drawing mode
      
      if (currentMode === 'complete_drawing') {
        // Check if there are user-created strokes
        const hasStrokes = watercolorBrush.hasUserStrokes();
        console.log('Complete Drawing mode - hasUserStrokes:', hasStrokes);
        
        if (hasStrokes) {
          // User has drawn something - clear user drawings but preserve generated shape
          if (typeof window.showToast === 'function') {
            window.showToast('Your drawings cleared - shape preserved');
          }
          
          // Clear watercolor brush (user drawings)
          watercolorBrush.clear();
          
          // Stop fade timer
          fadeTimer.stop();
          
          // Clear only foreground canvas (user drawings)
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // Background canvas (generated shape) remains untouched
        } else {
          // No user drawings - show nudging message
          const nudgingMessages = [
            "Make your mark",
            "Try something new", 
            "Drift and add your mark"
          ];
          const randomMessage = nudgingMessages[Math.floor(Math.random() * nudgingMessages.length)];
          
          if (typeof window.showToast === 'function') {
            window.showToast(randomMessage);
          }
        }
        
        return;
      }
      
      // For other modes, clear everything normally
      // Track the clear event
      umami.track('clear_drawing');
      // Show zen-like toast notification
      if (typeof window.showToast === 'function') {
        window.showToast('Drawing cleared');
      }
      // Clear watercolor brush
      watercolorBrush.clear();
      // Stop fade timer
      fadeTimer.stop();
      // Slow dissolve animation
      if (typeof window.dissolveCanvas === 'function') {
        window.dissolveCanvas();
        setTimeout(() => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }, 2000);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
  }
  // Improved resize handling with debouncing
  let resizeTimeout;
  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      resizeCanvas();
      // Don't reinitialize color palette on resize - preserve current colors
      // initZenColorPalette(); // Removed to prevent color loss on resize
    }, 150); // Increased delay for better stability
  }
  
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  
  // Use ResizeObserver if available, fallback to window events
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(handleResize);
    ro.observe(canvas.parentElement);
  }

  // Mouse tracking events
  canvas.addEventListener('mousemove', updateCursorPosition);
  canvas.addEventListener('mouseenter', () => {
    if (cursor) cursor.style.display = 'block';
  });
  canvas.addEventListener('mouseleave', () => {
    if (cursor) cursor.style.display = 'none';
  });

  // Touch tracking events for mobile cursor
  canvas.addEventListener('touchstart', updateCursorPosition, { passive: true });
  canvas.addEventListener('touchmove', updateCursorPosition, { passive: true });
  canvas.addEventListener('touchend', updateCursorPosition, { passive: true });

  // Initialize zen color palette
  function initZenColorPalette() {
    const zenColorsContainer = document.getElementById('zen-colors');
    if (!zenColorsContainer) return;
    
    const zenColors = watercolorBrush.getZenColors();
    
    zenColors.forEach((color, index) => {
      const colorElement = document.createElement('div');
      colorElement.className = 'zen-color-swatch';
      colorElement.style.backgroundColor = color;
      colorElement.setAttribute('data-color', color);
      colorElement.setAttribute('data-index', index);
      
      // Add click handler
      colorElement.addEventListener('click', () => {
        // Track color change
        umami.track('color_changed', { 
          color: color, 
          color_index: index 
        });
        
        // Remove active class from all colors
        document.querySelectorAll('.zen-color-swatch').forEach(el => el.classList.remove('active'));
        // Add active class to clicked color
        colorElement.classList.add('active');
        
        // Update watercolor brush color
        watercolorBrush.setColor(index);
        
        // Update stroke color for compatibility
        strokeColor = color;
        
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
  }

  // Color picker functionality
  function initColorPicker() {
    if (!colorPickerBtn || !currentColorDiv || !colorPopup) {
      return;
    }
    
    // Set initial color
    const zenColors = watercolorBrush.getZenColors();
    if (zenColors.length > 0) {
      currentColorDiv.style.backgroundColor = zenColors[0];
    }
    
    // Toggle popup on button click
    colorPickerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const isVisible = colorPopup.style.display === 'block';
      colorPopup.style.display = isVisible ? 'none' : 'block';
    });
    
    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
      if (!colorPickerBtn.contains(e.target) && !colorPopup.contains(e.target)) {
        colorPopup.style.display = 'none';
      }
    });
    
    // Update current color when a color is selected
    document.addEventListener('colorSelected', (e) => {
      // Track color change
      umami.track('color_changed', { 
        color: e.detail.color, 
        color_index: e.detail.index 
      });
      
      currentColorDiv.style.backgroundColor = e.detail.color;
      colorPopup.style.display = 'none';
    });
  }

  // Tool picker functionality
  function initToolPicker() {
    if (!toolBtn) return;
    
    // Set initial tool
    updateToolDisplay();
    
    // Toggle tool on click
    toolBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      currentTool = currentTool === 'brush' ? 'eraser' : 'brush';
      updateToolDisplay();
      updateStrokeWidth();
      
      // Track tool change
      umami.track('tool_changed', { 
        tool: currentTool
      });
    });
  }
  
  function updateToolDisplay() {
    if (!toolBtn) return;

    toolBtn.textContent = currentTool === 'brush' ? '🖌️' : '🧽';
    toolBtn.className = currentTool === 'brush' ? 'tool-btn' : 'tool-btn eraser';

    // Track tool usage
    if (window.feedbackCollector) {
      window.feedbackCollector.trackToolUsage(currentTool);
    }

    // Show tool-specific toast message
    const toolMessages = {
      'brush': [
        "Brush ready - paint with intention",
        "Create with purpose",
        "Let your creativity flow",
        "Paint your thoughts",
        "Express yourself",
        "Make your mark"
      ],
      'eraser': [
        "Eraser ready - clear with purpose",
        "Make space for new ideas",
        "Clear the canvas of doubt",
        "Erase and begin again",
        "Start fresh",
        "Make room for possibility"
      ]
    };

    const messages = toolMessages[currentTool];
    if (messages && messages.length > 0) {
      // Show toast 60% of the time to avoid overwhelming the user
      if (Math.random() < 0.6) {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        // Show toast after a short delay
        setTimeout(() => {
          window.showToast(randomMessage);
        }, 300);
      }
    }
  }
  
  function updateStrokeWidth() {
    const sizes = currentTool === 'brush' ? brushSizes : eraserSizes;
    strokeWidth = sizes[currentSize];
    
    // Update size picker button
    if (sizePickerBtn) {
      sizePickerBtn.textContent = currentSize;
    }
    
    // Update the old range input if it exists (for compatibility)
    if (sizeInput) {
      sizeInput.value = strokeWidth;
    }
    
    // Update watercolor brush size
    watercolorBrush.setSize(strokeWidth);
    
    // Update cursor size
    updateCursorSize();
  }

  // Size picker functionality
  function initSizePicker() {
    if (!sizePickerBtn || !sizePopup || !sizeOptions) return;
    
    // Create size options
    const sizes = ['S', 'M', 'L', 'XL'];
    sizeOptions.innerHTML = '';
    
    sizes.forEach(size => {
      const option = document.createElement('button');
      option.className = 'size-option';
      option.textContent = size;
      option.setAttribute('data-size', size);
      
      if (size === currentSize) {
        option.classList.add('active');
      }
      
      option.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Remove active class from all options
        document.querySelectorAll('.size-option').forEach(el => el.classList.remove('active'));
        // Add active class to clicked option
        option.classList.add('active');
        
        currentSize = size;
        updateStrokeWidth();
        sizePopup.style.display = 'none';
        
        // Track size change
        umami.track('size_changed', { 
          size: currentSize,
          tool: currentTool,
          actual_size: strokeWidth
        });
      });
      
      sizeOptions.appendChild(option);
    });
    
    // Toggle popup on button click
    sizePickerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const isVisible = sizePopup.style.display === 'block';
      sizePopup.style.display = isVisible ? 'none' : 'block';
    });
    
    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
      if (!sizePickerBtn.contains(e.target) && !sizePopup.contains(e.target)) {
        sizePopup.style.display = 'none';
      }
    });
  }

  // Initialize onboarding modal
  function initOnboarding() {
    const logo = document.getElementById('logo');
    const onboardingModal = document.getElementById('onboarding-modal');
    const onboardingClose = document.getElementById('onboarding-close');
    
    if (!logo || !onboardingModal || !onboardingClose) return;
    
    // Check if user has seen onboarding before
    const hasSeenOnboarding = localStorage.getItem('driftpad-onboarding-seen');
    
    // Show onboarding on first visit
    if (!hasSeenOnboarding) {
      setTimeout(() => {
        onboardingModal.style.display = 'flex';
        // Track onboarding view
        if (typeof umami !== 'undefined') {
          umami.track('onboarding_viewed');
        }
      }, 1000); // Small delay to let page load
    }
    
    // Logo click to show onboarding
    logo.addEventListener('click', () => {
      onboardingModal.style.display = 'flex';
      // Track logo click
      if (typeof umami !== 'undefined') {
        umami.track('onboarding_manual_open');
      }
    });
    
    // Close onboarding
    onboardingClose.addEventListener('click', () => {
      onboardingModal.style.display = 'none';
      localStorage.setItem('driftpad-onboarding-seen', 'true');
      // Track onboarding completion
      if (typeof umami !== 'undefined') {
        umami.track('onboarding_completed');
      }
    });
    
    // Close on backdrop click
          onboardingModal.addEventListener('click', (e) => {
            if (e.target === onboardingModal) {
              onboardingModal.style.display = 'none';
              localStorage.setItem('driftpad-onboarding-seen', 'true');
              if (typeof umami !== 'undefined') {
                umami.track('onboarding_completed');
              }
            }
          });

          // Handle feedback button click
          const feedbackButton = document.getElementById('feedback-button');
          if (feedbackButton) {
            feedbackButton.addEventListener('click', (e) => {
              e.preventDefault();
              // Close onboarding modal
              onboardingModal.style.display = 'none';
              localStorage.setItem('driftpad-onboarding-seen', 'true');
              // Open feedback modal directly
              const feedbackModal = document.getElementById('feedback-modal');
              if (feedbackModal) {
                feedbackModal.style.display = 'flex';
              }
              if (typeof umami !== 'undefined') {
                umami.track('onboarding_feedback_clicked');
              }
            });
          }
  }

  // Make resizeCanvas globally accessible
  window.resizeCanvas = resizeCanvas;
  
  // Init
  resizeCanvas();
  updateCursorSize(); // Set initial cursor size
  initZenColorPalette(); // Initialize zen color palette
  initColorPicker(); // Initialize color picker
  initToolPicker(); // Initialize tool picker
  initSizePicker(); // Initialize size picker
  initOnboarding(); // Initialize onboarding modal


  // Helpers
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function computeWidth(pressure, speed) {
    const maxW = strokeWidth;
    const minW = Math.max(0.6, maxW * 0.18);
    // Speed reduces width (faster -> thinner). Map speed ~[0..1] to [1..0.3]
    const speedFactor = clamp(1 / (1 + 2.5 * speed), 0.3, 1);
    // Pressure increases width (if available)
    const pressureFactor = clamp(0.6 + 0.8 * pressure, 0.6, 1.4);
    const w = clamp(maxW * speedFactor * pressureFactor, minW, maxW);
    return w;
  }
});
