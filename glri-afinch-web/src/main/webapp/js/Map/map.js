Ext.ns("AFINCH");

AFINCH.MapPanel = Ext.extend(GeoExt.MapPanel, {
    border: false,
    map: undefined,
    nhdFlowlineLayername: 'glri:NHDFlowline',
    gageLayername: 'glri:GageLoc',
    wmsGetFeatureInfoControl: undefined,
    WGS84_GOOGLE_MERCATOR: new OpenLayers.Projection("EPSG:900913"),
    sosEndpointUrl:'ftp://ftpext.usgs.gov/pub/er/wi/middleton/dblodgett/example_monthly_swecsv.xml',
    restrictedMapExtent: new OpenLayers.Bounds(-93.18993823245728, 40.398554803028716, -73.65211352945056, 48.11264392438207).transform(new OpenLayers.Projection("EPSG:4326"), new OpenLayers.Projection("EPSG:900913")),
    streamOrderClipValue: 0,
    flowlineAboveClipPixelR: 255,
    flowlineAboveClipPixelG: 255,
    flowlineAboveClipPixelB: 255,
    flowlineAboveClipPixelA: 128,
    flowlineAboveClipPixel: undefined,
    gageStyleR: 0,
    gageStyleG: 255,
    gageStyleB: 0,
    gageStyleA: 255,
    gageRadius: 4,
    gageFill: false,
    gageStyle: undefined,
    defaultMapConfig: {
        layers: {
            baseLayers: [],
            overlays: []
        },
        initialZoom: undefined
    },
    constructor: function(config) {
        LOG.debug('map.js::constructor()');
        var config = config || {};

        var EPSG900913Options = {
            sphericalMercator: true,
            layers: "0",
            isBaseLayer: true,
            projection: this.WGS84_GOOGLE_MERCATOR,
            units: "m",
            buffer: 3,
            transitionEffect: 'resize'
        };

        var zyx = '/MapServer/tile/${z}/${y}/${x}';
        this.defaultMapConfig.layers.baseLayers = [
            new OpenLayers.Layer.XYZ(
                    "World Light Gray Base",
                    "http://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base" + zyx,
                    Ext.apply(EPSG900913Options, {numZoomLevels: 14})
                    ),
            new OpenLayers.Layer.XYZ(
                    "World Terrain Base",
                    "http://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief" + zyx,
                    Ext.apply(EPSG900913Options, {numZoomLevels: 14})
                    ),
            new OpenLayers.Layer.XYZ(
                    "USA Topo Map",
                    "http://services.arcgisonline.com/ArcGIS/rest/services/USA_Topo_Maps" + zyx,
                    Ext.apply(EPSG900913Options, {numZoomLevels: 16})
                    )
        ];

        // ////////////////////////////////////////////// FLOWLINES
        LOG.debug('AFINCH.MapPanel::constructor: Setting up flow lines layer');
        var flowlinesLayer = new OpenLayers.Layer.WMS(
                'NHD Flowlines',
                CONFIG.endpoint.geoserver + 'glri/wms',
                {
                    layers: [this.nhdFlowlineLayername],
                    styles: "line",
                    format: "image/png",
                    tiled: true
                },
        {
            isBaseLayer: false,
            unsupportedBrowsers: [],
            tileOptions: {
                maxGetUrlLength: 2048
            }
        });
        flowlinesLayer.id = 'nhd-flowlines-layer';
        this.defaultMapConfig.layers.overlays.push(flowlinesLayer);

        LOG.debug('AFINCH.MapPanel::constructor: Setting up flow lines WMS Data Layer');
        var flowlinesWMSData = new OpenLayers.Layer.FlowlinesData(
                "Flowline WMS (Data)",
                CONFIG.endpoint.geoserver + 'glri/wms',
                {
                    layers: [this.nhdFlowlineLayername],
                    styles: 'FlowlineStreamOrder',
                    format: "image/png",
                    tiled: "true"
                },
                {
    isBaseLayer: false,
    opacity: 0,
    displayInLayerSwitcher: true,
    tileOptions: {
        crossOriginKeyword: 'anonymous'
    }
});
        flowlinesWMSData.id = 'nhd-flowlines-data-layer';
        this.defaultMapConfig.layers.overlays.push(flowlinesWMSData);

        LOG.debug('AFINCH.MapPanel::constructor: Setting up flowlines raster Layer');
        this.flowlineAboveClipPixel = this.createFlowlineAboveClipPixel({
            a: this.flowlineAboveClipPixelA,
            b: this.flowlineAboveClipPixelB,
            g: this.flowlineAboveClipPixelG,
            r: this.flowlineAboveClipPixelR
        });
        var flowlineRaster = new OpenLayers.Layer.FlowlinesRaster({
            name: "NHD Flowlines Raster",
            data: flowlinesWMSData.createFlowlineClipData({
                streamOrderClipValue: this.streamOrderClipValue,
                flowlineAboveClipPixel: this.flowlineAboveClipPixel
            })
        });
        flowlineRaster.id = 'nhd-flowlines-raster-layer';
        this.defaultMapConfig.layers.overlays.push(flowlineRaster);


        // ////////////////////////////////////////////// GAGES
        var gageLocationsLayer = new OpenLayers.Layer.WMS(
                'Gage Locations',
                CONFIG.endpoint.geoserver + 'glri/wms',
                {
                    layers: 'GageLoc',    
                    tiled: true,
                    sld_body: this.gagePointSymbolizer,
                    format: "image/png"
                },
        {
            isBaseLayer: false,
            unsupportedBrowsers: [],
            tileOptions: {
                maxGetUrlLength: 2048,
                crossOriginKeyword: 'anonymous'
            }
        });
        gageLocationsLayer.id = 'gage-location-layer';
        this.defaultMapConfig.layers.overlays.push(gageLocationsLayer);

        var gageFeatureLayer = new OpenLayers.Layer.GageFeature('Gage Locations', {
            url: CONFIG.endpoint.geoserver + 'glri/wfs'
        });
        gageFeatureLayer.id = 'gage-feature-layer';
        this.defaultMapConfig.layers.overlays.push(gageFeatureLayer);
        var gageWMSData = new OpenLayers.Layer.GageData(
                "Gage WMS (Data)",
                CONFIG.endpoint.geoserver + 'glri/wms',
                {
                    layers: [this.gageLayername]
                }
        );
        var gageComposite = OpenLayers.Raster.Composite.fromLayer(gageWMSData, {int32: true});

        // MAP
        this.map = new OpenLayers.Map({
            restrictedExtent: this.restrictedMapExtent,
            projection: this.WGS84_GOOGLE_MERCATOR,
            controls: [
                new OpenLayers.Control.Navigation(),
                new OpenLayers.Control.MousePosition({
                    prefix: 'POS: '
                }),
                new OpenLayers.Control.Attribution({template:
                            '<img id="attribution" src="' + CONFIG.mapLogoUrl + '"/>'}),
                new OpenLayers.Control.OverviewMap(),
                new OpenLayers.Control.ScaleLine({
                    geodesic: true
                }),
                new OpenLayers.Control.LayerSwitcher(),
                new OpenLayers.Control.Zoom()
            ]
        });

        config = Ext.apply({
            id: 'map-panel',
            region: 'center',
            map: this.map,
            extent: this.defaultMapConfig.initialExtent,
            prettyStateKeys: true,
            layers: new GeoExt.data.LayerStore({
                initDir: GeoExt.data.LayerStore.STORE_TO_MAP,
                map: this.map,
                layers: this.defaultMapConfig.layers.baseLayers.union(this.defaultMapConfig.layers.overlays)
            }),
            border: false,
            listeners: {
                afterlayout: function(panel, layout) {
                    var mapZoomForExtent = panel.map.getZoomForExtent(panel.map.restrictedExtent);

                    panel.map.isValidZoomLevel = function(zoomLevel) {
                        return zoomLevel && zoomLevel >= mapZoomForExtent && zoomLevel < this.getNumZoomLevels();
                    };

                    panel.map.setCenter(panel.map.restrictedExtent.getCenterLonLat(), mapZoomForExtent);

                    panel.streamOrderClipValue = panel.streamOrderClipValues[panel.map.zoom];
                }
            }
        }, config);

        AFINCH.MapPanel.superclass.constructor.call(this, config);
        LOG.info('map.js::constructor(): Construction complete.');

        this.wmsGetFeatureInfoControl = new OpenLayers.Control.WMSGetFeatureInfo({
            title: 'gage-identify-control',
            hover: false,
            autoActivate: true,
            layers: this.defaultMapConfig.layers.overlays,
            queryVisible: true,
            output: 'object',
            drillDown: true,
            infoFormat: 'application/vnd.ogc.gml',
            vendorParams: {
                radius: 5
            }
        });

        this.wmsGetFeatureInfoControl.events.register("getfeatureinfo", this, this.wmsGetFeatureInfoHandler);
        this.map.addControl(this.wmsGetFeatureInfoControl);
//debug:
this.displayGageDataWindow({data:{"feature":{"layer":null,"lonlat":null,"data":{"COMID":"0","EVENTDATE":"2006-11-21T00:00:00","REACHCODE":"04070007000079","REACHRESOL":"Medium","FEATURECOM":"0","FEATURECLA":"0","SOURCE_ORI":"USGS, Water Resources Division","SOURCE_DAT":null,"SOURCE_FEA":"04136000","FEATUREDET":"http://waterdata.usgs.gov/nwis/nwisman/?site_no=04136000","MEASURE":"68.9925654625","OFFSET":"0.0","EVENTTYPE":"StreamGage","ComID":"12952772","Fdate":"2011-01-08T00:00:00","StreamLeve":"1","StreamOrde":"5","StreamCalc":"5","FromNode":"90036983","ToNode":"90037109","Hydroseq":"90012175","LevelPathI":"90005945","Pathlength":"136.438","TerminalPa":"90005945","ArbolateSu":"639.214","Divergence":"0","StartFlag":"0","TerminalFl":"0","DnLevel":"1","ThinnerCod":"0","UpLevelPat":"90005945","UpHydroseq":"90012364","DnLevelPat":"90005945","DnMinorHyd":"0","DnDrainCou":"1","DnHydroseq":"90011993","FromMeas":"0.0","ToMeas":"100.0","LengthKM":"6.468","Fcode":"46006","RtnDiv":"0","OutDiv":"0","DivEffect":"0","VPUIn":"0","VPUOut":"0","TravTime":"0.0","PathTime":"0.0","AreaSqKM":"13.2039","TotDASqKM":"2789.4069","DivDASqKM":"2789.4069"},"id":"OpenLayers.Feature.Vector_5664","geometry":{"id":"OpenLayers.Geometry.Point_5663","x":-9383394.31635411,"y":5570754.48056071},"state":null,"attributes":{"COMID":"0","EVENTDATE":"2006-11-21T00:00:00","REACHCODE":"04070007000079","REACHRESOL":"Medium","FEATURECOM":"0","FEATURECLA":"0","SOURCE_ORI":"USGS, Water Resources Division","SOURCE_DAT":null,"SOURCE_FEA":"04136000","FEATUREDET":"http://waterdata.usgs.gov/nwis/nwisman/?site_no=04136000","MEASURE":"68.9925654625","OFFSET":"0.0","EVENTTYPE":"StreamGage","ComID":"12952772","Fdate":"2011-01-08T00:00:00","StreamLeve":"1","StreamOrde":"5","StreamCalc":"5","FromNode":"90036983","ToNode":"90037109","Hydroseq":"90012175","LevelPathI":"90005945","Pathlength":"136.438","TerminalPa":"90005945","ArbolateSu":"639.214","Divergence":"0","StartFlag":"0","TerminalFl":"0","DnLevel":"1","ThinnerCod":"0","UpLevelPat":"90005945","UpHydroseq":"90012364","DnLevelPat":"90005945","DnMinorHyd":"0","DnDrainCou":"1","DnHydroseq":"90011993","FromMeas":"0.0","ToMeas":"100.0","LengthKM":"6.468","Fcode":"46006","RtnDiv":"0","OutDiv":"0","DivEffect":"0","VPUIn":"0","VPUOut":"0","TravTime":"0.0","PathTime":"0.0","AreaSqKM":"13.2039","TotDASqKM":"2789.4069","DivDASqKM":"2789.4069"},"style":null,"gml":{"featureType":"GageLoc","featureNS":"http://cida.usgs.gov/glri","featureNSPrefix":"glri"},"fid":"GageLoc.644"},"state":null,"fid":"GageLoc.644","ComID":12952772,"TotDASqKM":"2789.4069","REACHCODE":"04070007000079","SOURCE_FEA":"04136000"}});
},
    statsCallback : function(statsStores, success) {

            if(!success || !statsStores){
                new Ext.ux.Notify({
                    msgWidth: 200,
                    title: 'Error',
                    msg: "Error retrieving data from server. See browser logs for details."
                }).show(document);  
                return;
            }
            //attach it to the Ext window so header, footer elts will have easy access
            this.statsStores = statsStores;
            this.add(new AFINCH.ui.StatsGraphPanel({
                statsStores: statsStores
            }));
            this.show();
            this.center();


        //            statsStores.each(function(statsStore) {
        //               
        //            
        //            });
        },
    sosCallback : function(response, options){
        var win = this;

        var params = {
            sosEndpointUrl: self.sosEndpointUrl
        };
        //@todo: this is getting instantiated only to use the method, then discarded
        //          make it a static method
        var statsStore = new AFINCH.data.StatsStore();

        statsStore.load({
            params: params,
            scope: win,
            callback: statsCallback
        });

    },

    /**
     * @param record - a reach's record.
     * 
     */
    displayDataWindow: function(record){

        //check to see if a Gage data window already exists. If so, destroy it.
        var dataDisplayWindow = Ext.ComponentMgr.get('data-display-window');
        if (dataDisplayWindow) {
            LOG.debug('Removing previous data display window');
            dataDisplayWindow.destroy();
        }
        var name = gageRecord.data.GNIS_NAME || "";
        var gageID = gageRecord.data.COMID || "";
        var title = name.length ? name + " - " : "";
        title += gageID;

        //init a window that will be used as context for the callback
        var win = new AFINCH.ui.GageDataWindow({
            id: 'data-display-window',
            title: title
        });
        
        var params = {};//@todo pass record properties into ajax params
        Ext.ajax.request({
            url: '/glri-afinch/js/Data/dummyValues.xml',
            success: self.sosCallback,
            params: params,
            scope: win
        }
        );        
    },
    wmsGetFeatureInfoHandler: function(responseObject) {
        var self = this;
        var popup = Ext.ComponentMgr.get('identify-popup-window');
        var dataDisplayWindow = Ext.ComponentMgr.get('data-display-window');
        if (popup) {
            popup.destroy();
        }
        if (dataDisplayWindow) {
            dataDisplayWindow.destroy();
        }

        var features = responseObject.features[0].features;
        var layerFeatures = {
            'GageLoc': [],
            'NHDFlowline': []
        };
        var gageLocFeatureStore, nhdFlowLineFeatureStore;

        if (features.length) {
            features.each(function(feature) {
                layerFeatures[feature.gml.featureType].push(feature);
            });
        }

        gageLocFeatureStore = new GeoExt.data.FeatureStore({
            features: layerFeatures.GageLoc,
            fields: [
                {name: 'ComID', type: 'int'},
                {name: 'TotDASqKM', type: 'double'},
                {name: 'REACHCODE', type: 'long'},
                {name: 'SOURCE_FEA', type: 'long'}
            ],
            initDir: 0
        });

        nhdFlowLineFeatureStore = new GeoExt.data.FeatureStore({
            features: layerFeatures.NHDFlowline,
            fields: [
                {name: 'COMID', type: 'long'},
                {name: 'GNIS_NAME', type: 'string'}
            ],
            initDir: 0
        });

        if (gageLocFeatureStore.totalLength || nhdFlowLineFeatureStore.totalLength) {
            var featureGrids = [];

            var featureSelectionModel = new GeoExt.grid.FeatureSelectionModel({
                layerFromStore: true,
                singleSelect: true,
                listeners: {
                    rowselect: function(obj, rowIndex, record) {
                        self.displayDataWindow(record);
                    }
                }
            });

            if (gageLocFeatureStore.totalLength) {
                featureGrids.push(new gxp.grid.FeatureGrid({
                    id: 'identify-popup-grid-gage',
                    title: 'Gage',
                    store: gageLocFeatureStore,
                    region: 'center',
                    autoHeight: true,
                    deferRowRender: false,
                    forceLayout: true,
                    sm: featureSelectionModel,
                    viewConfig: {
                        autoFill: true,
                        forceFit: true
                    }
                }));
            }

            if (nhdFlowLineFeatureStore.totalLength) {
                featureGrids.push(new gxp.grid.FeatureGrid({
                    id: 'identify-popup-grid-flowline',
                    title: 'NHD Flowlines',
                    store: nhdFlowLineFeatureStore,
                    region: 'center',
                    autoHeight: true,
                    deferRowRender: false,
                    forceLayout: true,
                    sm: featureSelectionModel,
                    viewConfig: {
                        autoFill: true,
                        forceFit: true
                    }
                }));
            }

            popup = new GeoExt.Popup({
                id: 'identify-popup-window',
                anchored: false,
                layout: 'fit',
                map: CONFIG.mapPanel.map,
                unpinnable: true,
                minWidth: 200,
                minHeight: 100,
                items: [
                    new Ext.TabPanel({
                        id: 'identify-popup-tabpanel',
                        region: 'center',
                        activeTab: 0,
                        autoScroll: true,
                        layoutOnTabChange: true,
                        monitorResize: true,
                        resizeTabs: true,
                        items: featureGrids,
                        width: 400,
                        height: 200
                    })
                ],
                listeners: {
                    show: function() {
                        // Remove the anchor element (setting anchored to 
                        // false does not do this for us. *Shaking fist @ GeoExt)
                        Ext.select('.gx-popup-anc').remove();
                        this.syncSize();
                        this.setHeight(this.items.first().getActiveTab().getHeight());
                        this.setHeight(this.items.first().getActiveTab().getWidth());
                    }
                }

            });
            popup.show();
        }

    },
    createFlowlineAboveClipPixel: function(args) {
        var flowlineAboveClipPixelA = args.a;
        var flowlineAboveClipPixelB = args.b;
        var flowlineAboveClipPixelG = args.g;
        var flowlineAboveClipPixelR = args.r;

        return ((flowlineAboveClipPixelA & 0xff) << 24 |
                (flowlineAboveClipPixelB & 0xff) << 16 |
                (flowlineAboveClipPixelG & 0xff) << 8 |
                (flowlineAboveClipPixelR & 0xff));
    },
    streamOrderClipValues: [
        7, // 0
        7,
        7,
        6,
        6,
        6, // 5
        5,
        5,
        5,
        4,
        4, // 10
        4,
        3,
        3,
        3,
        2, // 15
        2,
        2,
        1,
        1,
        1  // 20
    ],
    gagePointSymbolizer: new OpenLayers.Format.SLD().write({
        namedLayers: [{
                name: "glri:GageLoc",
                userStyles: [
                    new OpenLayers.Style("Gage Style",
                            {
                                rules: [
                                    new OpenLayers.Rule({
                                        symbolizer: {
                                            Point: new OpenLayers.Symbolizer.Point({
                                                graphicName: 'Circle',
                                                strokeColor: '#99FF99',
                                                fillColor: '#00FF00',
                                                pointRadius: 4,
                                                fillOpacity: 0.5,
                                                strokeOpacity: 0.5
                                            })
                                        }
                                    })
                                ]
                            })
                ]
            }]
    }),
    createGageStyle: function(args) {
        var gageStyleA = args.a;
        var gageStyleR = args.R;
        var gageStyleG = args.G;
        var gageStyleB = args.B;
        return ("rgba(" +
                gageStyleR + "," +
                gageStyleG + "," +
                gageStyleB + "," +
                gageStyleA / 255 + ")");

    }
});
