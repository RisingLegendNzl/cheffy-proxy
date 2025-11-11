// web/src/components/landing/TestimonialsSection.jsx
import React, { useRef } from 'react';
import { Star } from 'lucide-react';
import { COLORS } from '../../constants';
import { useInView } from '../../hooks/useResponsive'; // <-- Import useInView

/**
 * Testimonials Section Component
 * Displays customer reviews and ratings
 */
const TestimonialsSection = () => {
  const testimonials = [
    // ... (testimonials array remains the same)
    {
      name: 'Sarah Johnson',
      role: 'Fitness Enthusiast',
      avatar: '👩‍💼',
      rating: 5,
      quote: 'Cheffy transformed my meal prep routine! The AI suggestions are spot-on, and I\'ve hit my macro targets consistently for 3 months now.'
    },
    {
      name: 'Mike Chen',
      role: 'Busy Professional',
      avatar: '👨‍💻',
      rating: 5,
      quote: 'As someone with a hectic schedule, Cheffy\'s quick recipes and weekly planning features are game-changers. I save hours every week!'
    },
    {
      name: 'Emily Rodriguez',
      role: 'Health Coach',
      avatar: '👩‍⚕️',
      rating: 5,
      quote: 'I recommend Cheffy to all my clients. The macro tracking is accurate, and the meal variety keeps healthy eating exciting and sustainable.'
    }
  ];

  // --- Add Animation Hooks ---
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { threshold: 0.1, triggerOnce: true });
  // --- End Animation Hooks ---

  return (
    <section
      ref={sectionRef} // <-- Assign ref to section
      className="py-20 md:py-32 bg-white transition-opacity duration-500"
      style={{ opacity: isInView ? 1 : 0 }} // <-- Fade in section
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {/* Section Header */}
        <div
          className={`text-center mb-16 ${
            isInView ? 'animate-fadeInUp' : 'opacity-0'
          }`}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4 font-poppins">
            <span style={{ color: COLORS.gray[900] }}>Loved by</span>
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Thousands of Users
            </span>
          </h2>
          <p 
            className="text-lg md:text-xl max-w-3xl mx-auto"
            style={{ color: COLORS.gray[600] }}
          >
            See what our community has to say about their Cheffy experience.
          </p>
        </div>

        {/* Testimonials Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              /*
                ADD:
                - stagger-item class for animation
                - Opacity 0 to hide before animation
                - isInView check to trigger animation
              */
              className={`bg-white p-8 rounded-2xl border-2 hover:shadow-xl transition-all ${
                isInView ? 'stagger-item' : 'opacity-0'
              }`}
              style={{ 
                borderColor: COLORS.gray[200],
                animationDelay: `${index * 100}ms` // <-- Stagger delay
              }}
            >
              {/* Star Rating */}
              <div className="flex space-x-1 mb-4">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <Star
                    key={i}
                    size={20}
                    fill={COLORS.warning.main}
                    color={COLORS.warning.main}
                  />
                ))}
              </div>

              {/* Quote */}
              <blockquote 
                className="text-base italic mb-6 leading-relaxed"
                style={{ color: COLORS.gray[700] }}
              >
                "{testimonial.quote}"
              </blockquote>

              {/* Divider */}
              <div 
                className="w-full h-px mb-6"
                style={{ backgroundColor: COLORS.gray[200] }}
              ></div>

              {/* Author */}
              <div className="flex items-center space-x-4">
                <div 
                  className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
                  style={{ backgroundColor: COLORS.gray[100] }}
                >
                  {testimonial.avatar}
                </div>
                <div>
                  <div 
                    className="font-bold text-base"
                    style={{ color: COLORS.gray[900] }}
                  >
                    {testimonial.name}
                  </div>
                  <div 
                    className="text-sm"
                    style={{ color: COLORS.gray[600] }}
                  >
                    {testimonial.role}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;

