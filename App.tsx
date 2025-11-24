
import React, { useState, useEffect } from 'react';
import { ProcessingStep, ProductInput, AnalysisResult, GeneratedSection } from './types';
import { analyzeProductData, generateProductImage } from './services/geminiService';
import InputStep from './components/InputStep';
import Preview from './components/Preview';
import SectionControl from './components/SectionControl';
import { translations } from './constants/translations';
import { Wand2, AlertCircle, Key, Globe, Download, Loader2 } from 'lucide-react';
import JSZip from 'jszip';

// Extend Window interface for AI Studio
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}

const App: React.FC = () => {
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [step, setStep] = useState<ProcessingStep>(ProcessingStep.Input);
  const [inputData, setInputData] = useState<ProductInput | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const t = translations[language];

  // Check for API Key selection on mount
  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setApiKeyReady(hasKey);
      } else {
        setApiKeyReady(false);
      }
    };
    checkApiKey();
  }, []);

  const handleSelectKey = async () => {
    try {
      if (window.aistudio && window.aistudio.openSelectKey) {
        await window.aistudio.openSelectKey();
        setApiKeyReady(true);
        setError(null);
      }
    } catch (e) {
      console.error(e);
      setError("Failed to select API Key. Please try again.");
    }
  };

  const handleStart = async (data: ProductInput) => {
    if (!apiKeyReady) {
      setError(t.apiKeyError);
      return;
    }

    setInputData(data);
    setStep(ProcessingStep.Analyzing);
    setError(null);

    try {
      // 1. Analyze Product
      const result = await analyzeProductData(
        data.referenceImages,
        data.name,
        data.features + (data.targetAudience ? ` Target Audience: ${data.targetAudience}` : ''),
        language
      );
      
      // Initialize status for sections
      const sectionsWithStatus = result.sections.map(s => ({
        ...s,
        status: s.type === 'specs_size' || s.type === 'trust_endorsement' ? 'completed' : 'pending',
        isEditing: false
      })) as GeneratedSection[];

      setAnalysis({ ...result, sections: sectionsWithStatus });
      setStep(ProcessingStep.Planning); // Move to Planning/Execution phase

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during processing.");
      setStep(ProcessingStep.Input);
    }
  };

  const handleGenerateSection = async (sectionId: string) => {
    if (!analysis || !inputData) return;

    setAnalysis(prev => {
      if (!prev) return null;
      return {
        ...prev,
        sections: prev.sections.map(s => s.id === sectionId ? { ...s, status: 'generating' } : s)
      };
    });

    try {
      const section = analysis.sections.find(s => s.id === sectionId);
      if (!section) return;

      // Find the specific reference image suggested by AI or User
      let refImg = inputData.referenceImages.find(img => img.id === section.referenceImageId);
      if (!refImg) {
        // Fallback to main or first image
        refImg = inputData.referenceImages.find(img => img.label === 'main') || inputData.referenceImages[0];
      }

      if (!refImg) throw new Error("No reference image available");

      const imageUrl = await generateProductImage(
        refImg.base64,
        refImg.mimeType,
        section.imagePrompt
      );

      setAnalysis(prev => {
        if (!prev) return null;
        return {
          ...prev,
          sections: prev.sections.map(s => s.id === sectionId ? { 
            ...s, 
            generatedImageUrl: imageUrl,
            status: 'completed' 
          } : s)
        };
      });

    } catch (e) {
      console.error(`Failed to generate image for section ${sectionId}`, e);
      setAnalysis(prev => {
        if (!prev) return null;
        return {
          ...prev,
          sections: prev.sections.map(s => s.id === sectionId ? { ...s, status: 'failed' } : s)
        };
      });
    }
  };

  const handleUpdateSection = (id: string, updates: Partial<GeneratedSection>) => {
    setAnalysis(prev => {
      if (!prev) return null;
      return {
        ...prev,
        sections: prev.sections.map(s => s.id === id ? { ...s, ...updates } : s)
      };
    });
  };

  const handleDeleteSection = (id: string) => {
    setAnalysis(prev => {
      if (!prev) return null;
      return {
        ...prev,
        sections: prev.sections.filter(s => s.id !== id)
      };
    });
  };

  const handleDownloadPackage = async () => {
    if (!analysis) return;
    setIsZipping(true);

    try {
      const zip = new JSZip();
      
      // Text Content
      let textContent = `# ${analysis.refinedTitle}\n\n`;
      textContent += `Price Estimate: ${analysis.priceEstimate}\n`;
      textContent += `Marketing Tone: ${analysis.marketingTone}\n\n`;
      textContent += `## Selling Points\n${analysis.refinedSellingPoints.map(p => `- ${p}`).join('\n')}\n\n`;
      textContent += `## Section Details\n`;
      
      analysis.sections.forEach((section, index) => {
        textContent += `\n### ${index + 1}. ${section.title} [${section.type}]\n`;
        textContent += `Copy: ${section.content}\n`;
        if (section.overlayText) textContent += `Overlay Text: ${section.overlayText}\n`;
        if (section.imagePrompt) textContent += `Image Prompt: ${section.imagePrompt}\n`;
        if (section.referenceImageId) textContent += `Source Image ID: ${section.referenceImageId}\n`;
      });
      
      zip.file("product_details.txt", textContent);

      // Images
      const imgFolder = zip.folder("images");
      if (imgFolder) {
        analysis.sections.forEach((section, index) => {
          if (section.generatedImageUrl) {
            const base64Data = section.generatedImageUrl.split(',')[1];
            let ext = 'png';
            if (section.generatedImageUrl.includes('image/jpeg')) ext = 'jpg';
            imgFolder.file(`${index+1}_${section.type}.${ext}`, base64Data, {base64: true});
          }
        });
      }

      const content = await zip.generateAsync({type:"blob"});
      const url = window.URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${analysis.refinedTitle.replace(/\s+/g, '_')}_douyin_assets.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

    } catch (e) {
      console.error("Failed to zip files", e);
      setError("Failed to create download package.");
    } finally {
      setIsZipping(false);
    }
  };

  if (!apiKeyReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-gray-100">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Key size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">{t.apiKeyRequired}</h1>
          <p className="text-gray-600 mb-6">{t.apiKeyDesc}</p>
          <button 
            onClick={handleSelectKey}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
          >
            {t.selectKeyBtn}
          </button>
          <div className="mt-4 text-xs text-gray-400">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-blue-500">
              {t.viewBilling}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row font-sans">
      
      {/* Left Sidebar / Controls */}
      <div className="w-full lg:w-5/12 xl:w-2/5 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0 z-20 overflow-y-auto">
        <div className="p-6 pb-2 border-b border-gray-50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-md shadow-indigo-200">
                 <Wand2 size={16} />
              </div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">{t.appTitle}</h1>
            </div>
            
            <button 
              onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors"
            >
              <Globe size={14} />
              {language === 'en' ? 'EN' : '中文'}
            </button>
          </div>
        </div>

        <div className="flex-1 p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 text-sm">
              <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {step === ProcessingStep.Input && (
            <InputStep 
              onStart={handleStart} 
              isProcessing={false} 
              lang={language}
            />
          )}

          {(step !== ProcessingStep.Input && analysis) && (
            <div className="space-y-6">
              
              {/* Header Status */}
              <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                <h3 className="font-bold text-indigo-900 mb-1 flex items-center gap-2">
                  {step === ProcessingStep.Analyzing ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <Wand2 size={16} />
                  )}
                  {step === ProcessingStep.Analyzing ? t.analyzing : t.planningStep}
                </h3>
                <p className="text-sm text-indigo-700 opacity-80 mb-3">
                  {step === ProcessingStep.Analyzing ? t.analyzingBtn : t.planningDesc}
                </p>

                {/* Global Download Button */}
                <button 
                  onClick={handleDownloadPackage}
                  disabled={isZipping}
                  className="w-full mt-1 flex items-center justify-center gap-2 py-2 bg-white text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors text-xs font-bold shadow-sm"
                >
                  {isZipping ? <Loader2 className="animate-spin" size={14}/> : <Download size={14} />}
                  {isZipping ? t.downloading : t.downloadPackage}
                </button>
              </div>

              {/* Analysis Info Card */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-3">
                 <div>
                   <span className="text-xs text-gray-500 font-bold uppercase tracking-wider block mb-1">{t.refinedTitle}</span>
                   <p className="font-medium text-gray-900 text-sm">{analysis.refinedTitle}</p>
                 </div>
                 <div className="flex gap-4">
                   <div>
                     <span className="text-xs text-gray-500 font-bold uppercase tracking-wider block mb-1">Price</span>
                     <span className="text-sm font-mono text-gray-800">{analysis.priceEstimate}</span>
                   </div>
                   <div>
                     <span className="text-xs text-gray-500 font-bold uppercase tracking-wider block mb-1">{t.marketingTone}</span>
                     <span className="text-sm font-medium text-gray-800">{analysis.marketingTone}</span>
                   </div>
                 </div>
              </div>

              {/* Section Controls List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{t.pageSections}</h4>
                <div className="space-y-4">
                  {analysis.sections.map((section, idx) => (
                    <SectionControl
                      key={section.id}
                      index={idx}
                      section={section}
                      referenceImages={inputData?.referenceImages || []}
                      lang={language}
                      onUpdate={handleUpdateSection}
                      onGenerate={handleGenerateSection}
                      onDelete={handleDeleteSection}
                    />
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>

      {/* Right Preview Area */}
      <div className="flex-1 bg-gray-100 min-h-screen flex items-center justify-center p-4 lg:p-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5 pointer-events-none" 
             style={{
               backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
               backgroundSize: '24px 24px'
             }}>
        </div>
        
        {analysis ? (
          <Preview 
            analysis={analysis} 
            referenceImages={inputData?.referenceImages || []} 
            lang={language}
          />
        ) : (
          <div className="text-center text-gray-400 max-w-sm">
             <div className="w-24 h-24 bg-gray-200 rounded-3xl mx-auto mb-6 opacity-50 rotate-3 border-4 border-white shadow-xl"></div>
             <h3 className="text-lg font-medium mb-2">{t.previewAwaits}</h3>
             <p className="text-sm">{t.previewDesc}</p>
          </div>
        )}
      </div>

    </div>
  );
};

export default App;
