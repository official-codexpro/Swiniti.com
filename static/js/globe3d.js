/**
 * Globe3D - Interactive 3D Political Globe
 *
 * A world-class, performant 3D globe with country interactions,
 * theming, and programmatic control.
 *
 * @module Globe3D
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Initialize the 3D Globe
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Object} config - Configuration object
 * @returns {Object} API object with control methods
 */
export function initGlobe(canvas, config = {}) {
    // Default configuration
    const defaults = {
        activeCountries: [],
        countryLinks: {},
        countryMeta: {},
        theme: {
            primary: '#F97316',
            land: '#1f2937',
            border: '#475569',
            water: '#0f172a',
            hover: '#22D3EE',      // Cyan for hover - distinctly different
            active: '#FBBF24',      // Bright yellow-orange for active countries
            activeEmissive: '#F97316'  // Orange glow for active
        },
        autoRotate: true,
        autoRotateSpeed: 0.3,
        onCountryHover: null,
        onCountryClick: null
    };

    const settings = { ...defaults, ...config };
    const state = {
        hoveredCountry: null,
        focusedCountry: null,
        isAutoRotating: settings.autoRotate,
        countries: [],
        countryMeshes: new Map(),
        activeCountries: new Set(settings.activeCountries)
    };

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(settings.theme.water);

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
        45,
        canvas.parentElement.clientWidth / canvas.parentElement.clientHeight,
        0.1,
        1000
    );
    camera.position.z = 2.5;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight);

    // Controls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 1.5;
    controls.maxDistance = 4;
    controls.enablePan = false;
    controls.autoRotate = state.isAutoRotating;
    controls.autoRotateSpeed = settings.autoRotateSpeed;

    // Globe sphere (water)
    const globeGeometry = new THREE.SphereGeometry(1, 64, 64);
    const globeMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(settings.theme.water),
        transparent: true,
        opacity: 1
    });
    const globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
    scene.add(globeMesh);

    // Atmosphere glow
    const atmosphereGeometry = new THREE.SphereGeometry(1.05, 64, 64);
    const atmosphereMaterial = new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
                gl_FragColor = vec4(0.3, 0.5, 1.0, 1.0) * intensity;
            }
        `,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true
    });
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    scene.add(atmosphere);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(5, 3, 5);
    scene.add(directionalLight);

    // Raycaster for country detection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // Tooltip elements
    const tooltip = document.getElementById('globe-tooltip');
    const tooltipCountry = document.getElementById('tooltip-country');
    const tooltipMeta = document.getElementById('tooltip-meta');
    const announcer = document.getElementById('globe-announcer');
    const loadingEl = document.getElementById('globe-loading');

    /**
     * Convert lat/lon to 3D coordinates on sphere
     */
    function latLonToVector3(lat, lon, radius = 1) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);

        return new THREE.Vector3(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }

    /**
     * Create country mesh from GeoJSON coordinates
     */
    function createCountryMesh(geometry, properties) {
        const vertices = [];
        const indices = [];
        let vertexIndex = 0;

        const processPolygon = (coords) => {
            // Convert each coordinate to 3D point on sphere
            const points3D = coords.map(coord => {
                const [lon, lat] = coord;
                return latLonToVector3(lat, lon, 1.005); // Slightly above sphere surface
            });

            // Create vertices for this polygon
            const startIndex = vertexIndex;
            points3D.forEach(point => {
                vertices.push(point.x, point.y, point.z);
                vertexIndex++;
            });

            // Create triangles using simple fan triangulation
            for (let i = 1; i < points3D.length - 1; i++) {
                indices.push(startIndex, startIndex + i, startIndex + i + 1);
            }
        };

        // Handle both Polygon and MultiPolygon
        if (geometry.type === 'Polygon') {
            geometry.coordinates.forEach(ring => processPolygon(ring));
        } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach(polygon => {
                polygon.forEach(ring => processPolygon(ring));
            });
        }

        if (vertices.length === 0) return null;

        // Create BufferGeometry
        const meshGeometry = new THREE.BufferGeometry();
        meshGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        meshGeometry.setIndex(indices);
        meshGeometry.computeVertexNormals();

        const isActive = state.activeCountries.has(properties.iso_a3);
        const color = isActive ? settings.theme.active : settings.theme.land;

        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(color),
            emissive: isActive ? new THREE.Color(settings.theme.activeEmissive) : new THREE.Color(0x000000),
            emissiveIntensity: isActive ? 0.8 : 0,
            metalness: 0.1,
            roughness: 0.7,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(meshGeometry, material);
        mesh.userData = {
            country: properties.name,
            iso_a3: properties.iso_a3,
            iso_a2: properties.iso_a2,
            isActive: isActive
        };

        return mesh;
    }

    /**
     * Create country outline
     */
    function createCountryOutline(geometry) {
        const points = [];

        const processRing = (ring) => {
            ring.forEach(coord => {
                const [lon, lat] = coord;
                const vec = latLonToVector3(lat, lon, 1.006);
                points.push(vec);
            });
        };

        if (geometry.type === 'Polygon') {
            geometry.coordinates.forEach(ring => processRing(ring));
        } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach(polygon => {
                polygon.forEach(ring => processRing(ring));
            });
        }

        if (points.length === 0) return null;

        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMaterial = new THREE.LineBasicMaterial({
            color: new THREE.Color(settings.theme.border),
            linewidth: 1,
            transparent: true,
            opacity: 0.6
        });

        return new THREE.Line(lineGeometry, lineMaterial);
    }

    /**
     * Load and render countries
     */
    async function loadCountries() {
        try {
            const response = await fetch('/static/data/countries.geo.json');
            const geojson = await response.json();

            const countriesGroup = new THREE.Group();

            geojson.features.forEach(feature => {
                const mesh = createCountryMesh(feature.geometry, feature.properties);
                if (mesh) {
                    countriesGroup.add(mesh);
                    state.countryMeshes.set(feature.properties.iso_a3, mesh);
                }

                const outline = createCountryOutline(feature.geometry);
                if (outline) {
                    countriesGroup.add(outline);
                }
            });

            scene.add(countriesGroup);

            // Hide loading
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

            state.countries = geojson.features;
        } catch (error) {
            console.error('Error loading countries:', error);
            if (loadingEl) {
                loadingEl.innerHTML = '<div class="text-center text-white"><p class="mb-4">Error loading globe data</p><button onclick="location.reload()" class="px-4 py-2 bg-primary rounded-lg">Retry</button></div>';
            }
        }
    }

    /**
     * Handle mouse move for hover effects
     */
    function onMouseMove(event) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);

        let hoveredMesh = null;

        for (const intersect of intersects) {
            if (intersect.object.userData && intersect.object.userData.country) {
                hoveredMesh = intersect.object;
                break;
            }
        }

        if (hoveredMesh) {
            // Hover effect
            if (state.hoveredCountry !== hoveredMesh) {
                // Reset previous
                if (state.hoveredCountry) {
                    const isActive = state.activeCountries.has(state.hoveredCountry.userData.iso_a3);
                    state.hoveredCountry.material.color.setHex(
                        isActive ? parseInt(settings.theme.active.replace('#', '0x')) : parseInt(settings.theme.land.replace('#', '0x'))
                    );
                    state.hoveredCountry.material.emissive.setHex(
                        isActive ? parseInt(settings.theme.activeEmissive.replace('#', '0x')) : 0x000000
                    );
                    state.hoveredCountry.material.emissiveIntensity = isActive ? 0.8 : 0;
                }

                state.hoveredCountry = hoveredMesh;
                hoveredMesh.material.color.setHex(parseInt(settings.theme.hover.replace('#', '0x')));
                hoveredMesh.material.emissive.setHex(parseInt(settings.theme.hover.replace('#', '0x')));
                hoveredMesh.material.emissiveIntensity = 1.0;  // Maximum glow for hover
                canvas.style.cursor = 'pointer';

                // Show tooltip
                tooltip.classList.add('visible');
                tooltipCountry.textContent = hoveredMesh.userData.country;

                // Meta info
                const meta = settings.countryMeta[hoveredMesh.userData.iso_a3];
                if (meta) {
                    const metaText = Object.entries(meta)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(' • ');
                    tooltipMeta.textContent = metaText;
                } else {
                    tooltipMeta.textContent = hoveredMesh.userData.iso_a3;
                }

                // Announce for screen readers
                if (announcer) {
                    announcer.textContent = `Focused: ${hoveredMesh.userData.country}`;
                }

                // Callback
                if (settings.onCountryHover) {
                    settings.onCountryHover(hoveredMesh.userData);
                }
            }

            // Position tooltip
            tooltip.style.left = `${event.clientX + 15}px`;
            tooltip.style.top = `${event.clientY + 15}px`;
        } else {
            // No hover
            if (state.hoveredCountry) {
                const isActive = state.activeCountries.has(state.hoveredCountry.userData.iso_a3);
                state.hoveredCountry.material.color.setHex(
                    isActive ? parseInt(settings.theme.active.replace('#', '0x')) : parseInt(settings.theme.land.replace('#', '0x'))
                );
                state.hoveredCountry.material.emissive.setHex(
                    isActive ? parseInt(settings.theme.activeEmissive.replace('#', '0x')) : 0x000000
                );
                state.hoveredCountry.material.emissiveIntensity = isActive ? 0.8 : 0;
                state.hoveredCountry = null;
            }
            canvas.style.cursor = 'grab';
            tooltip.classList.remove('visible');
        }
    }

    /**
     * Handle click on country
     */
    function onClick(event) {
        if (state.hoveredCountry) {
            const iso = state.hoveredCountry.userData.iso_a3;
            const countryData = state.hoveredCountry.userData;

            // Callback
            if (settings.onCountryClick) {
                settings.onCountryClick(countryData);
            }

            // Focus country
            API.focusCountry(iso, { zoom: 1.5, duration: 800 });

            // Navigate if link exists
            if (settings.countryLinks[iso]) {
                setTimeout(() => {
                    window.location.href = settings.countryLinks[iso];
                }, 1000);
            }
        }
    }

    // Event listeners
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);

    // Handle canvas active state
    canvas.addEventListener('mousedown', () => {
        canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('mouseup', () => {
        canvas.style.cursor = state.hoveredCountry ? 'pointer' : 'grab';
    });

    // Resize handler
    function onResize() {
        const width = canvas.parentElement.clientWidth;
        const height = canvas.parentElement.clientHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    window.addEventListener('resize', onResize);

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    // API
    const API = {
        /**
         * Set auto-rotate
         */
        setAutoRotate(enabled, speed = settings.autoRotateSpeed) {
            state.isAutoRotating = enabled;
            controls.autoRotate = enabled;
            if (speed !== undefined) {
                controls.autoRotateSpeed = speed;
            }
        },

        /**
         * Focus on a specific country
         */
        focusCountry(iso, options = {}) {
            const { zoom = 1.2, duration = 800 } = options;
            const mesh = state.countryMeshes.get(iso);

            if (!mesh) {
                console.warn(`Country ${iso} not found`);
                return;
            }

            // Get country center
            mesh.geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            mesh.geometry.boundingBox.getCenter(center);
            mesh.localToWorld(center);

            // Calculate camera position
            const distance = zoom * 2;
            const direction = center.clone().normalize();
            const targetPosition = direction.multiplyScalar(distance);

            // Smooth transition
            const start = {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z
            };
            const startTime = Date.now();

            function animateCamera() {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

                camera.position.x = start.x + (targetPosition.x - start.x) * eased;
                camera.position.y = start.y + (targetPosition.y - start.y) * eased;
                camera.position.z = start.z + (targetPosition.z - start.z) * eased;

                camera.lookAt(0, 0, 0);

                if (progress < 1) {
                    requestAnimationFrame(animateCamera);
                }
            }

            animateCamera();
            state.focusedCountry = iso;
        },

        /**
         * Reset view to default
         */
        resetView() {
            camera.position.set(0, 0, 2.5);
            camera.lookAt(0, 0, 0);
            controls.reset();
        },

        /**
         * Set active countries
         */
        setActiveCountries(isoCodes) {
            state.activeCountries = new Set(isoCodes);

            // Update all country meshes
            state.countryMeshes.forEach((mesh, iso) => {
                const isActive = state.activeCountries.has(iso);
                mesh.userData.isActive = isActive;
                mesh.material.color.setHex(
                    isActive ? parseInt(settings.theme.active.replace('#', '0x')) : parseInt(settings.theme.land.replace('#', '0x'))
                );
                mesh.material.emissive.setHex(
                    isActive ? parseInt(settings.theme.activeEmissive.replace('#', '0x')) : 0x000000
                );
                mesh.material.emissiveIntensity = isActive ? 0.8 : 0;
            });
        },

        /**
         * Add active country
         */
        addActiveCountry(iso) {
            state.activeCountries.add(iso);
            this.setActiveCountries(Array.from(state.activeCountries));
        },

        /**
         * Clear active countries
         */
        clearActiveCountries() {
            this.setActiveCountries([]);
        },

        /**
         * Update theme
         */
        setTheme(theme) {
            Object.assign(settings.theme, theme);
            this.setActiveCountries(Array.from(state.activeCountries));
        },

        /**
         * Get current state
         */
        getState() {
            return {
                hoveredCountry: state.hoveredCountry?.userData,
                focusedCountry: state.focusedCountry,
                activeCountries: Array.from(state.activeCountries),
                isAutoRotating: state.isAutoRotating
            };
        },

        /**
         * Cleanup
         */
        destroy() {
            window.removeEventListener('resize', onResize);
            canvas.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('click', onClick);
            controls.dispose();
            renderer.dispose();
        }
    };

    // Initialize
    loadCountries();
    animate();

    return API;
}

export default { initGlobe };
