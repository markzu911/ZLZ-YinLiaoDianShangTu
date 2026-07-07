/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  History as HistoryIcon, 
  Settings, 
  Image as ImageIcon, 
  Wand2, 
  Sparkles,
  X, 
  Check, 
  Download, 
  Trash2,
  RefreshCw,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeProductImage, generateEcommerceImages, generateOneEcommerceImage, AnalysisResult, fetchSaasImages, launchTool, uploadToSaas } from './services/aiService';
import AgentView from './components/AgentView';
import { compressImage } from './utils';

interface TextItem {
  id: string;
  text: string;
  position: string; // 'tl', 'tc', 'tr', 'rc', 'br', 'bc', 'bl', 'lc'
}

interface SaasData {
  user: {
    id: string;
    name: string;
    enterprise: string;
    integral: number;
    role: number;
  };
  tool: {
    id: string;
    name: string;
    integral: number;
    status: string;
  };
}

interface HistoryItem {
  id: string;
  time: string;
  img: string;        // Base64
  angle: string;
  prompt: string;
  params: {
    style: string;
    aspectRatio: string;
    resolution: string;
  };
  // Internal fields for app functionality
  sourceImage: string;
  analysis: AnalysisResult;
  textItems: TextItem[];
  textColor: string;
}

const PROJECT_TYPE = "beverage-ecommerce-image-generator";
const SOURCE = "beverage-ecommerce-result";

export default function App() {
  const [saasInfo, setSaasInfo] = useState<{ userId: string; toolId: string } | null>(null);
  const [saasData, setSaasData] = useState<SaasData | null>(null);
  const [activeView, setActiveView] = useState<'editor' | 'history' | 'agent'>('editor');
  const [step, setStep] = useState(1);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  // Params
  const [style, setStyle] = useState('现代简约');
  const [perspective, setPerspective] = useState('正面视角');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1K');
  
  // Results
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // Text Editor State
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [textColor, setTextColor] = useState('#FFFFFF');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const toImageProxyUrl = (url: string) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/image-proxy')) return url;
    if (url.startsWith('http')) {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // Load history strictly from cloud
  useEffect(() => {
    const initializeSaas = async (userId: string, toolId: string) => {
      setSaasInfo({ userId, toolId });
      console.log('SaaS Initializing:', { userId, toolId });
      
      try {
        const launchResult = await launchTool(userId, toolId);
        if (launchResult.success) {
          setSaasData(launchResult.data);
        }
      } catch (err) {
        console.error('Launch failed', err);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SAAS_INIT') {
        const { userId, toolId } = event.data;
        initializeSaas(userId, toolId);
      }
    };
    window.addEventListener('message', handleMessage);
    
    // Also check URL parameters as a fallback (some SaaS patterns use this)
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const toolId = params.get('toolId');
    if (userId && toolId) {
      initializeSaas(userId, toolId);
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const compressed = await compressImage(file);
      setUploadedImage(compressed);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const compressed = await compressImage(file);
      setUploadedImage(compressed);
    }
  };

  const handleGenerate = async () => {
    if (!uploadedImage) return;
    
    setGenerating(true);
    setAnalyzing(true);
    setGeneratedImages([]);
    setStep(2);

    try {
      // Analyze once
      const analysisResult = await analyzeProductImage(uploadedImage, saasInfo?.userId, saasInfo?.toolId);
      setAnalysis(analysisResult);
      
      const initialTextItems: TextItem[] = [];
      
      // 1. Title
      initialTextItems.push({
        id: 'title',
        text: analysisResult.productName || "饮品",
        position: 'tc'
      });

      // 2. Selling Points
      (analysisResult.sellingPoints || []).forEach((sp, i) => {
        if (i < 3) {
          const detailText = typeof sp === 'string' ? sp : (sp?.text || "");
          const detailPos = typeof sp === 'string' ? 'tr' : (sp?.position || 'tr');
          if (detailText) {
            initialTextItems.push({
              id: `sp-${i}`,
              text: detailText,
              position: detailPos
            });
          }
        }
      });

      setTextItems(initialTextItems);
      setTextColor(analysisResult.suggestedColor);

      // Generate ONE image with selected perspective
      const imageUrl = await generateOneEcommerceImage(
        uploadedImage,
        style,
        aspectRatio,
        resolution,
        perspective,
        saasInfo?.userId,
        saasInfo?.toolId
      );

      setGeneratedImages([imageUrl]);
      setSelectedImageIndex(0);

      const newItem: HistoryItem = {
        id: Date.now().toString(),
        time: new Date().toLocaleString(),
        img: imageUrl,
        angle: perspective,
        prompt: `风格：${style}`,
        params: { style, aspectRatio, resolution },
        sourceImage: uploadedImage,
        analysis: analysisResult,
        textItems: initialTextItems,
        textColor: analysisResult.suggestedColor
      };
      setHistory(prev => [newItem, ...prev]);
      
      // Refresh credits
      if (saasInfo?.userId && saasInfo?.toolId) {
        launchTool(saasInfo.userId, saasInfo.toolId).then(res => {
          if (res.success) setSaasData(res.data);
        }).catch(console.error);
      }
      
    } catch (error: any) {
      console.error("Generation failed", error);
      
      const isTimeout = error.message.includes("Timeout") || error.message.includes("Gateway") || error.message.includes("504");
      
      if (isTimeout) {
        // Explicitly handle timeout
        alert(`生成耗时较长（超时），请稍候刷新重试。`);
      } else {
        alert(`生成失败: ${error.message}`);
      }
    } finally {
      setGenerating(false);
      setAnalyzing(false);
    }
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || generatedImages.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    const proxiedUrl = toImageProxyUrl(generatedImages[selectedImageIndex]);
    
    if (!proxiedUrl.startsWith('data:')) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const baseFontSize = img.height / 800;
      const titleSize = 36 * baseFontSize;
      const detailSize = 24 * baseFontSize;

      const titleX = img.width * 0.95; 
      const titleY = img.width * 0.05 + titleSize;
      const lineY = titleY + 12 * baseFontSize;

      if (textItems.length > 0) {
        ctx.save();
        ctx.font = `bold ${titleSize}px sans-serif`;
        ctx.fillStyle = textColor;
        ctx.textAlign = 'right';
        
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 6 * baseFontSize;
        ctx.shadowOffsetX = 2 * baseFontSize;
        ctx.shadowOffsetY = 2 * baseFontSize;
        
        ctx.fillText(textItems[0].text, titleX, titleY);
        ctx.restore();

        ctx.save();
        const titleWidth = ctx.measureText(textItems[0].text).width;
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 1.5 * baseFontSize;
        ctx.beginPath();
        ctx.moveTo(titleX - titleWidth, lineY);
        ctx.lineTo(titleX, lineY);
        ctx.stroke();
        ctx.restore();
      }

      const details = textItems.slice(1);
      if (details.length > 0) {
        ctx.save();
        ctx.textAlign = 'right';
        ctx.fillStyle = textColor;
        ctx.globalAlpha = 0.9;
        
        let currentY = lineY + 32 * baseFontSize;
        details.forEach((item) => {
          ctx.font = `500 ${detailSize}px sans-serif`;
          ctx.fillText(item.text, titleX, currentY);
          currentY += detailSize * 1.6;
        });
        ctx.restore();
      }
    };

    img.onerror = () => {
      console.error("Canvas load error:", proxiedUrl);
    };

    img.src = proxiedUrl;
  };

  useEffect(() => {
    if (generatedImages.length > 0 && activeView === 'editor' && step === 2) {
      drawCanvas();
    }
  }, [generatedImages, selectedImageIndex, textItems, textColor, activeView, step]);

  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const base64 = canvas.toDataURL('image/png');

    // 1. Local Download
    const link = document.createElement('a');
    link.download = `beverage-ecommerce-${Date.now()}.png`;
    link.href = base64;
    link.click();

    // 2. SaaS Cloud Save (Optional but requested for persistence)
    if (saasInfo?.userId && saasInfo?.toolId) {
      try {
        console.log("Saving composite to SaaS...");
        await uploadToSaas(
          base64,
          saasInfo.userId,
          saasInfo.toolId,
          "result",
          `composite_${Date.now()}.png`
        );
        console.log("Composite saved to SaaS successfully");
      } catch (err) {
        console.error("Failed to save composite to SaaS", err);
      }
    }
  };

  const removeFromHistory = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const loadFromHistory = (item: HistoryItem) => {
    setUploadedImage(item.sourceImage);
    setGeneratedImages([item.img]);
    setSelectedImageIndex(0);
    setAnalysis(item.analysis);
    setTextItems(item.textItems);
    setTextColor(item.textColor);
    setStyle(item.params.style);
    setAspectRatio(item.params.aspectRatio);
    setResolution(item.params.resolution);
    setStep(2);
    setActiveView('editor');
  };

  const handleAgentGenerationSuccess = (imageUrl: string, analysisResult: AnalysisResult, params: any) => {
    setGeneratedImages([imageUrl]);
    setSelectedImageIndex(0);
    setAnalysis(analysisResult);
    setStep(2);
    // Move to editor to show result
    setActiveView('editor');

    // Update Text Editor State
    const initialTextItems: TextItem[] = [];
    initialTextItems.push({
      id: 'title',
      text: analysisResult.productName || "饮品",
      position: 'tc'
    });
    (analysisResult.sellingPoints || []).forEach((sp, i) => {
      if (i < 3) {
        const detailText = typeof sp === 'string' ? sp : (sp?.text || "");
        const detailPos = typeof sp === 'string' ? 'tr' : (sp?.position || 'tr');
        if (detailText) {
          initialTextItems.push({
            id: `sp-${i}`,
            text: detailText,
            position: detailPos
          });
        }
      }
    });
    setTextItems(initialTextItems);
    setTextColor(analysisResult.suggestedColor);

    // Add to history
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      time: new Date().toLocaleString(),
      img: imageUrl,
      angle: params.perspective || '正面视角',
      prompt: `风格：${params.style}`,
      params: { 
        style: params.style || '现代简约', 
        aspectRatio: params.aspectRatio || '1:1', 
        resolution: params.resolution || '1K' 
      },
      sourceImage: uploadedImage!,
      analysis: analysisResult,
      textItems: initialTextItems,
      textColor: analysisResult.suggestedColor
    };
    setHistory(prev => [newItem, ...prev]);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1D1D1F] font-sans pb-20">
      {/* Universal Header */}
      <header className="sticky top-0 left-0 right-0 h-20 bg-white/80 backdrop-blur-md border-b border-[#E5E5E5] flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-8">
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <span className="bg-[#FF6B00] text-white p-1 rounded-lg">
              <ImageIcon size={18} />
            </span>
            AI 饮品电商
          </h1>
          
          <nav className="flex items-center gap-1 bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5E5]">
            <button 
              onClick={() => setActiveView('editor')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'editor' ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'}`}
            >
              设计编辑器
            </button>
            <button 
              onClick={() => setActiveView('agent')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeView === 'agent' ? 'bg-[#FF6B00] text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'}`}
            >
              <Sparkles size={12} />
              智能体生成
            </button>
            <button 
              onClick={() => setActiveView('history')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView === 'history' ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'}`}
            >
              云端记录
            </button>
          </nav>
        </div>
        
        <div className="flex items-center gap-4">
          <AnimatePresence mode="popLayout">
            {saasData ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="flex items-center gap-3 bg-white border border-[#E5E5E5] px-3 py-1.5 rounded-full shadow-sm hover:shadow-md transition-shadow cursor-default group"
              >
                <div className="w-7 h-7 bg-gradient-to-br from-[#FF6B00] to-[#FF9500] rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm ring-2 ring-white">
                  {saasData.user.name.charAt(0)}
                </div>
                <div className="flex flex-col pr-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold leading-none text-[#1D1D1F]">{saasData.user.name}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" title="已连接" />
                  </div>
                  <div className="text-[8px] text-[#86868B] font-medium mt-1 flex items-center gap-1">
                    <span>剩余积分:</span>
                    <span className="text-[#FF6B00] font-extrabold flex items-center gap-0.5">
                      {saasData.user.integral}
                      <Wand2 size={8} className="group-hover:rotate-12 transition-transform" />
                    </span>
                  </div>
                </div>
              </motion.div>
            ) : saasInfo ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 bg-[#F5F5F7] px-3 py-1.5 rounded-full border border-[#E5E5E5]"
              >
                <div className="w-7 h-7 bg-[#E5E5E5] rounded-full animate-pulse" />
                <div className="space-y-1.5">
                  <div className="w-12 h-2 bg-[#E5E5E5] rounded animate-pulse" />
                  <div className="w-16 h-2 bg-[#E5E5E5] rounded animate-pulse" />
                </div>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F5F5F7] text-[10px] font-bold text-[#86868B] border border-[#E5E5E5] cursor-help"
                title="预览模式：登录以保存记录"
              >
                <Plus size={12} /> 游客身份
              </motion.div>
            )}
          </AnimatePresence>
          
          <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold text-[#86868B] uppercase tracking-widest bg-[#F5F5F7] px-3 py-1.5 rounded-full border border-[#E5E5E5]/50">
            <span className={`transition-colors duration-300 ${step === 1 ? 'text-[#FF6B00]' : ''}`}>1. 上传</span>
            <span className="opacity-20 font-light">/</span>
            <span className={`transition-colors duration-300 ${step === 2 ? 'text-[#FF6B00]' : ''}`}>2. 生成</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 sm:p-8 relative">
        <AnimatePresence mode="wait">
          {activeView === 'agent' && (
            <motion.section
              key="agent"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-4xl mx-auto w-full h-[calc(100vh-160px)] min-h-[600px]"
            >
              <AgentView 
                saasInfo={saasInfo}
                uploadedImage={uploadedImage}
                setUploadedImage={setUploadedImage}
                onGenerationSuccess={handleAgentGenerationSuccess}
              />
            </motion.section>
          )}

          {activeView === 'history' && (
            <motion.section
              key="history-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-6xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold">云端生成记录</h2>
                  <p className="text-[#86868B] text-sm">查看并管理您在云端保存的作品</p>
                </div>
                <button 
                  onClick={() => setActiveView('editor')}
                  className="px-6 py-2.5 bg-[#1D1D1F] text-white rounded-full text-sm font-bold shadow-lg hover:bg-[#2c2c2e] transition-all"
                >
                  去创建新作品
                </button>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {history.map(item => (
                  <motion.div 
                    key={item.id}
                    whileHover={{ y: -5 }}
                    onClick={() => loadFromHistory(item)}
                    className="bg-white rounded-3xl p-4 border border-[#E5E5E5] cursor-pointer hover:shadow-2xl transition-all group"
                  >
                    <div className="relative aspect-square rounded-2xl overflow-hidden mb-4 bg-[#F5F5F7]">
                      <img 
                        src={toImageProxyUrl(item.img)} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                         <div className="bg-white/90 backdrop-blur p-2 rounded-full shadow-lg text-[#FF6B00]">
                            <ImageIcon size={16} />
                         </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="font-bold text-[#1D1D1F] truncate group-hover:text-[#FF6B00] transition-colors">{item.analysis.productName}</p>
                      <p className="text-xs text-[#86868B] font-medium">{item.time}</p>
                    </div>
                  </motion.div>
                ))}
                {history.length === 0 && (
                  <div className="col-span-full py-20 text-center bg-white rounded-[40px] border border-[#E5E5E5] border-dashed">
                    <HistoryIcon className="mx-auto text-[#D2D2D7] mb-4" size={48} />
                    <p className="text-[#86868B] font-medium">暂无云端记录，生成的作品将自动同步至此</p>
                  </div>
                )}
              </div>
            </motion.section>
          )}

          {activeView === 'editor' && step === 1 && (
            <motion.section 
              key="step1"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-6xl mx-auto space-y-8"
            >


              <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
                {/* Left: Upload Area */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">1</span>
                    <h2 className="text-lg font-bold">上传产品原图</h2>
                  </div>

                  <div 
                    onClick={() => mainFileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className={`
                      relative border-3 border-dashed rounded-[40px] aspect-video flex flex-col items-center justify-center cursor-pointer transition-all duration-500
                      ${uploadedImage 
                        ? 'border-[#FF6B00] bg-white shadow-2xl shadow-[#FF6B00]/10' 
                        : 'border-[#D2D2D7] bg-white hover:border-[#FF6B00] hover:bg-[#FFF8F2] shadow-sm'}
                    `}
                  >
                    <input 
                      type="file" 
                      ref={mainFileInputRef} 
                      className="hidden" 
                      accept="image/*" 
                      onChange={handleFileUpload} 
                    />
                    
                    {uploadedImage ? (
                      <div className="relative w-full h-full p-8 flex items-center justify-center">
                        <img 
                          src={toImageProxyUrl(uploadedImage)} 
                          alt="Preview" 
                          className="max-w-full max-h-full object-contain rounded-2xl shadow-lg" 
                        />
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button 
                             onClick={(e) => { e.stopPropagation(); setUploadedImage(null); }}
                             className="p-3 bg-white/90 backdrop-blur rounded-full shadow-lg text-red-500 hover:bg-white transition-colors"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-8 space-y-4">
                        <div className="w-20 h-20 bg-[#F5F5F7] rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                          <Upload className="text-[#86868B]" size={32} />
                        </div>
                        <div>
                          <p className="text-xl font-bold">点击或将图片拖拽至此</p>
                          <p className="text-[#86868B] mt-2">支持常见图片格式（如 JPG, PNG, WebP），最大支持 20MB（通过前端压缩上传）</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Parameters */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">2</span>
                    <h2 className="text-lg font-bold">设置生成参数</h2>
                  </div>

                  <div className="bg-white rounded-3xl p-6 sm:p-8 space-y-6 border border-[#E5E5E5] shadow-sm">
                    {/* Style Selection */}
                    <div>
                      <h3 className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-4">视觉风格</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {['现代简约', '奢华高级', '模特氛围'].map(s => (
                          <button
                            key={s}
                            onClick={() => setStyle(s)}
                            className={`px-4 py-2.5 rounded-xl text-xs font-medium transition-all ${style === s ? 'bg-[#FF6B00] text-white shadow-lg shadow-[#FF6B00]/20' : 'bg-[#F5F5F7] border border-transparent hover:border-[#FF6B00]'}`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Perspective Selection */}
                    <div>
                      <h3 className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-4">拍摄视角</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {['正面视角', '俯拍视角', '特写视角'].map(p => (
                          <button
                            key={p}
                            onClick={() => setPerspective(p)}
                            className={`py-2 rounded-xl text-[10px] font-bold border transition-all ${perspective === p ? 'border-[#FF6B00] bg-[#FFF8F2] text-[#FF6B00]' : 'border-transparent bg-[#F5F5F7] text-[#1D1D1F] hover:border-[#FF6B00]'}`}
                          >
                            {p.replace('视角', '')}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Canvas Ratio */}
                    <div>
                      <h3 className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-4">画布比例</h3>
                      <div className="grid grid-cols-4 gap-2">
                        {['1:1', '3:4', '4:3', '16:9'].map(r => (
                          <button
                            key={r}
                            onClick={() => setAspectRatio(r)}
                            className={`py-2.5 rounded-xl text-[10px] font-bold border transition-all ${aspectRatio === r ? 'border-[#FF6B00] bg-[#FFF8F2] text-[#FF6B00]' : 'border-transparent bg-[#F5F5F7] text-[#1D1D1F] hover:border-[#FF6B00]'}`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Resolution Selection */}
                    <div>
                      <h3 className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-4">输出分辨率</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {['1K', '2K', '4K'].map(res => (
                          <button
                            key={res}
                            onClick={() => setResolution(res)}
                            className={`py-2.5 rounded-xl text-[10px] font-bold border transition-all ${resolution === res ? 'border-[#FF6B00] bg-[#FFF8F2] text-[#FF6B00]' : 'border-transparent bg-[#F5F5F7] text-[#1D1D1F] hover:border-[#FF6B00]'}`}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button 
                      onClick={handleGenerate}
                      disabled={!uploadedImage || generating}
                      className="w-full py-4 mt-4 bg-[#1D1D1F] text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-[#2c2c2e] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      {generating ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <Wand2 className="group-hover:rotate-12 transition-transform" />
                      )}
                      {generating ? '正在为您打造中...' : '立即生成商品图'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          {activeView === 'editor' && step === 2 && (
            <motion.section 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="max-w-6xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setStep(1)}
                  className="px-4 py-2 bg-white rounded-full text-sm font-bold text-[#86868B] hover:text-[#1D1D1F] flex items-center gap-2 border border-[#E5E5E5] transition-all shadow-sm"
                >
                  <X size={16} /> 返回重设
                </button>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">2</span>
                  <h2 className="text-lg font-bold">结果预览与精修</h2>
                </div>
              </div>

              {generating && generatedImages.length === 0 ? (
                <div className="bg-white rounded-3xl min-h-[600px] flex flex-col items-center justify-center space-y-6 border border-[#E5E5E5] shadow-sm">
                  <div className="relative">
                     <RefreshCw className="text-[#FF6B00] animate-spin w-16 h-16 opacity-30" />
                     <div className="absolute inset-0 flex items-center justify-center">
                        <Wand2 className="text-[#FF6B00] animate-pulse" size={32} />
                     </div>
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold">AI 正在为您全力加速...</h3>
                    <p className="text-[#86868B] max-w-xs">正在渲染您的专属视觉大片，请稍后片刻</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
                  {/* Left Column: Canvas Preview */}
                  <div className="space-y-6">
                    <div 
                      onClick={() => !generating && generatedImages.length > 0 && setIsPreviewOpen(true)}
                      className="bg-white rounded-[40px] p-4 sm:p-8 flex flex-col items-center justify-center min-h-[500px] border border-[#E5E5E5] relative overflow-hidden group shadow-xl shadow-black/5 cursor-zoom-in"
                    >
                      <canvas 
                        ref={canvasRef} 
                        className="max-w-full max-h-[75vh] rounded-2xl shadow-2xl bg-white transition-transform group-hover:scale-[1.01]"
                      />
                      
                      <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg flex items-center gap-2 border border-[#E5E5E5] text-[10px] font-bold">
                           <Wand2 size={12} className="text-[#FF6B00]" /> 点击全屏预览
                        </div>
                      </div>

                      {generating && (
                        <div className="absolute bottom-6 right-6 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg flex items-center gap-3 border border-[#E5E5E5]">
                           <RefreshCw size={16} className="text-[#FF6B00] animate-spin" />
                           <span className="text-xs font-bold">重新生成中...</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Refinement Tools */}
                  <div className="space-y-6">
                    {/* Text Refinement */}
                    <div className="bg-white border border-[#E5E5E5] rounded-3xl p-6 sm:p-8 space-y-6 shadow-sm">
                      <div className="space-y-4">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                          <ImageIcon size={18} className="text-[#FF6B00]" /> 视觉文案精修
                        </h3>
                        <div className="space-y-5">
                          {textItems.map((item, i) => {
                            let label = i === 0 ? "主标题 (产品名)" : `卖点宣传语 ${i}`;
                            return (
                              <div key={item.id} className="space-y-1.5">
                                <label className="text-[10px] font-bold text-[#86868B] uppercase px-1">{label}</label>
                                <input 
                                  value={item.text} 
                                  onChange={(e) => {
                                    const newItems = [...textItems];
                                    newItems[i].text = e.target.value;
                                    setTextItems(newItems);
                                  }}
                                  className="w-full bg-[#F5F5F7] border border-[#E5E5E5] rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-[#FF6B00] outline-none transition-all"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-bold text-[#86868B] mb-3 uppercase tracking-wider">文字配色</h4>
                        <div className="flex flex-wrap gap-2">
                          {['#FFFFFF', '#000000', analysis?.suggestedColor || '#FF6B00', '#F5E6CC', '#D4AF37'].map(c => (
                            <button 
                              key={c}
                              onClick={() => setTextColor(c)}
                              style={{ backgroundColor: c }}
                              className={`w-8 h-8 rounded-full border-2 transition-all ${textColor === c ? 'border-[#FF6B00] scale-110 shadow-md' : 'border-[#E5E5E5] hover:scale-105'}`}
                            />
                          ))}
                          <input 
                            type="color" 
                            value={textColor} 
                            onChange={(e) => setTextColor(e.target.value)}
                            className="w-8 h-8 rounded-full border-none p-0 overflow-hidden cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="pt-4 space-y-3">
                        <button 
                          onClick={handleDownload}
                          className="w-full py-5 bg-[#FF6B00] text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-[#E66000] active:scale-[0.98] transition-all shadow-xl shadow-[#FF6B00]/30"
                        >
                          <Download size={20} /> 下载高清无水印图
                        </button>
                        
                        <button 
                          onClick={handleGenerate}
                          disabled={generating}
                          className="w-full py-3 bg-[#F5F5F7] text-[#1D1D1F] border border-[#E5E5E5] rounded-2xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-white transition-all disabled:opacity-50"
                        >
                          <RefreshCw className={generating ? 'animate-spin' : ''} size={14} /> 换一个试试
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* History Section at the bottom of Step 2 */}
              <div className="pt-12 border-t border-[#E5E5E5]">
                <div className="flex items-center justify-between mb-6">
                   <div className="flex items-center gap-2">
                     <HistoryIcon size={20} className="text-[#FF6B00]" />
                     <h2 className="text-xl font-bold">本地本次生成记录</h2>
                   </div>
                   <button 
                    onClick={() => setHistory([])}
                    className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-[#E5E5E5] text-xs font-bold text-[#86868B] hover:text-red-500 transition-all shadow-sm group"
                   >
                     <Trash2 size={14} className="group-hover:scale-110 transition-transform" /> 清空记录
                   </button>
                </div>

                {history.length === 0 ? (
                  <div className="bg-white rounded-3xl p-12 text-center border border-[#E5E5E5] border-dashed">
                    <p className="text-[#86868B]">暂无本地记录，本次会话生成的图将显示在此处</p>
                  </div>
                ) : (
                  <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-hide">
                    {history.map(item => (
                      <motion.div 
                        key={item.id}
                        whileHover={{ y: -5 }}
                        onClick={() => loadFromHistory(item)}
                        className="flex-shrink-0 w-64 bg-white rounded-2xl p-3 border border-[#E5E5E5] cursor-pointer hover:shadow-xl hover:border-[#FF6B00]/30 transition-all group"
                      >
                        <div className="relative aspect-square rounded-xl overflow-hidden mb-3 bg-[#F5F5F7]">
                          <img 
                            src={toImageProxyUrl(item.img)} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setHistory(prev => prev.filter(h => h.id !== item.id));
                            }}
                            className="absolute top-2 right-2 p-1.5 bg-white/90 backdrop-blur rounded-full text-[#86868B] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur rounded text-[8px] text-white font-bold">
                            {item.angle.replace('视角', '')}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-[#1D1D1F] truncate group-hover:text-[#FF6B00] transition-colors">
                            {item.analysis.productName}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[#86868B] font-medium">{item.time}</span>
                            <span className="text-[10px] bg-[#F5F5F7] px-2 py-0.5 rounded-full font-bold text-[#86868B]">{item.params.style}</span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Full Screen Preview Modal */}
      <AnimatePresence>
        {isPreviewOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 sm:p-12"
            onClick={() => setIsPreviewOpen(false)}
          >
            <motion.button 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-10"
              onClick={() => setIsPreviewOpen(false)}
            >
              <X size={24} />
            </motion.button>

            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative max-w-full max-h-full flex items-center justify-center p-4 bg-white/5 rounded-3xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={canvasRef.current?.toDataURL('image/png')} 
                alt="Full Preview" 
                className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
              />
              
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
                <button 
                  onClick={handleDownload}
                  className="px-6 py-3 bg-[#FF6B00] text-white rounded-full font-bold flex items-center gap-2 shadow-xl hover:bg-[#E66000] active:scale-95 transition-all"
                >
                  <Download size={18} /> 下载这张图片
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
