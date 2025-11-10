// web/src/components/landing/Footer.jsx
import React from 'react';
import { ChefHat, Twitter, Facebook, Instagram, Linkedin } from 'lucide-react';
import { COLORS } from '../../constants';

/**
 * Footer Component
 * Contains branding, social media links, and site navigation
 */
const Footer = () => {
  const productLinks = [
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'FAQ', href: '#faq' },
    { label: 'Roadmap', href: '#roadmap' }
  ];

  const companyLinks = [
    { label: 'About', href: '#about' },
    { label: 'Blog', href: '#blog' },
    { label: 'Careers', href: '#careers' },
    { label: 'Contact', href: '#contact' }
  ];

  const socialLinks = [
    { icon: <Twitter size={20} />, href: '#twitter', label: 'Twitter' },
    { icon: <Facebook size={20} />, href: '#facebook', label: 'Facebook' },
    { icon: <Instagram size={20} />, href: '#instagram', label: 'Instagram' },
    { icon: <Linkedin size={20} />, href: '#linkedin', label: 'LinkedIn' }
  ];

  return (
    <footer 
      className="border-t py-12"
      style={{ 
        backgroundColor: COLORS.gray[50],
        borderColor: COLORS.gray[200]
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Column */}
          <div className="md:col-span-2">
            <div className="flex items-center space-x-3 mb-4">
              <div
                className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full w-10 h-10 flex items-center justify-center"
              >
                <ChefHat className="text-white" size={20} />
              </div>
              <h3 
                className="text-xl font-bold font-poppins"
                style={{ color: COLORS.gray[900] }}
              >
                Cheffy
              </h3>
            </div>
            <p 
              className="text-sm mb-6 max-w-sm"
              style={{ color: COLORS.gray[600] }}
            >
              AI-powered meal planning and macro tracking for a healthier you.
            </p>

            {/* Social Media Icons */}
            <div className="flex space-x-4">
              {socialLinks.map((social, index) => (
                <a
                  key={index}
                  href={social.href}
                  aria-label={social.label}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110"
                  style={{ 
                    backgroundColor: COLORS.gray[200],
                    color: COLORS.gray[700]
                  }}
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h4 
              className="text-sm font-bold mb-4"
              style={{ color: COLORS.gray[900] }}
            >
              Product
            </h4>
            <ul className="space-y-2">
              {productLinks.map((link, index) => (
                <li key={index}>
                  <a
                    href={link.href}
                    className="text-sm hover:underline"
                    style={{ color: COLORS.gray[600] }}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h4 
              className="text-sm font-bold mb-4"
              style={{ color: COLORS.gray[900] }}
            >
              Company
            </h4>
            <ul className="space-y-2">
              {companyLinks.map((link, index) => (
                <li key={index}>
                  <a
                    href={link.href}
                    className="text-sm hover:underline"
                    style={{ color: COLORS.gray[600] }}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div 
          className="pt-8 border-t text-center"
          style={{ borderColor: COLORS.gray[200] }}
        >
          <p 
            className="text-sm"
            style={{ color: COLORS.gray[600] }}
          >
            © {new Date().getFullYear()} Cheffy. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;